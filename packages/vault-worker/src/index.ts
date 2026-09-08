import { spawn } from "node:child_process";
import { providerAccessBundleSchema, type Capability, type ProviderAccessBundle } from "@finity/schemas";

export type VaultErrorCode = "EGRESS_BLOCKED" | "CAPABILITY_REPLAY" | "CAPABILITY_EXPIRED" | "VAULT_DECRYPT_FAILED";
export class VaultError extends Error {
  constructor(readonly code: VaultErrorCode, message: string) { super(message); this.name = "VaultError"; }
}

export type WalletPassProvider = () => Promise<string>;
export type SafeLogger = { info(event: string, fields?: Record<string, unknown>): void; error(event: string, fields?: Record<string, unknown>): void };
const noLog: SafeLogger = { info() {}, error() {} };

/** Redacts all credential-bearing fields before a worker can write diagnostics. */
export function redact(fields: Record<string, unknown>, pab?: ProviderAccessBundle): Record<string, unknown> {
  const secretNames = new Set(["authorization", "x-api-key", "cookie", "wallet_pass", pab?.injection.name.toLowerCase() ?? ""]);
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [
    key,
    secretNames.has(key.toLowerCase()) ? "[REDACTED]" : value,
  ]));
}

export async function decryptKeyRingBundle(ciphertext: Uint8Array, keyName: string, walletPass: WalletPassProvider): Promise<Buffer> {
  const pass = await walletPass();
  if (!pass) throw new VaultError("VAULT_DECRYPT_FAILED", "wallet password was unavailable");
  return new Promise((resolve, reject) => {
    // Decryption returns the bundle's raw plaintext on stdout. wallet-cli's
    // JSON mode is metadata-only and rejects binary plaintext without --out.
    const child = spawn("wallet-cli", ["ring", "decrypt", "--key", keyName], {
      env: { PATH: process.env.PATH ?? "", WALLET_PASS: pass }, stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = []; const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", () => reject(new VaultError("VAULT_DECRYPT_FAILED", "wallet-cli could not start")));
    child.once("close", (code) => {
      if (code !== 0) { reject(new VaultError("VAULT_DECRYPT_FAILED", "wallet-cli refused bundle decryption")); return; }
      resolve(Buffer.concat(output));
    });
    child.stdin.end(ciphertext);
  });
}

export type LeaseRequest = { capability: Capability; pab: ProviderAccessBundle; now: number };
export type VaultLease = { invoke(path: string, init?: RequestInit): Promise<Response>; close(): void };

/** Capability-scoped connector. It never returns PAB plaintext or the injected request. */
export class VaultWorker {
  private readonly used = new Set<string>();
  constructor(private readonly logger: SafeLogger = noLog) {}

  lease(input: LeaseRequest): VaultLease {
    const pab = providerAccessBundleSchema.parse(input.pab);
    const { capability, now } = input;
    if (now >= capability.expiresAt) throw new VaultError("CAPABILITY_EXPIRED", "capability has expired");
    if (this.used.has(capability.capabilityId)) throw new VaultError("CAPABILITY_REPLAY", "capability was already leased");
    this.used.add(capability.capabilityId);
    let closed = false;
    const origins = new Set(pab.endpointAllowlist.map((item) => new URL(item).origin));
    return {
      invoke: async (path, init = {}) => {
        if (closed || Math.floor(Date.now() / 1000) >= capability.expiresAt) throw new VaultError("CAPABILITY_EXPIRED", "lease is closed or expired");
        const url = new URL(path, pab.endpointAllowlist[0]);
        if (!origins.has(url.origin)) throw new VaultError("EGRESS_BLOCKED", "destination is not in the Provider Access Bundle allowlist");
        const headers = new Headers(init.headers);
        const secret = Object.values(pab.credentials)[0];
        if (secret === undefined) throw new VaultError("VAULT_DECRYPT_FAILED", "Provider Access Bundle has no credential");
        const rendered = pab.injection.format.replace("{secret}", secret);
        if (pab.injection.location === "header") headers.set(pab.injection.name, rendered);
        else url.searchParams.set(pab.injection.name, rendered);
        const response = await fetch(url, { ...init, headers, redirect: "manual" });
        if (response.status >= 300 && response.status < 400) throw new VaultError("EGRESS_BLOCKED", "provider redirect was blocked");
        this.logger.info("vault.invoke", redact({ host: url.host, status: response.status }, pab));
        return response;
      },
      close: () => { closed = true; },
    };
  }
}
