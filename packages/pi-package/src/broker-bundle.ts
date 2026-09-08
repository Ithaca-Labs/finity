import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decryptKeyRingBundle, type WalletPassProvider } from "@finity/vault-worker";
import { brokerBundleSchema, type BrokerBundle } from "@finity/schemas";

export type GeneratedBrokerKey = { brokerSessionKey: `0x${string}`; brokerAddress: `0x${string}` };

const pendingBrokerBundleSchema = z.object({
  version: z.literal(1),
  brokerSessionKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  brokerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
export type PendingBrokerBundle = z.infer<typeof pendingBrokerBundleSchema>;

/** Generates the ECDSA secp256k1 Broker Session Key. Its EVM address is also the funding target for the Spend Account (Hedera auto-creates the account on first receipt). */
export function generateBrokerSessionKey(): GeneratedBrokerKey {
  const brokerSessionKey = generatePrivateKey();
  return { brokerSessionKey, brokerAddress: privateKeyToAccount(brokerSessionKey).address };
}

export class WalletCliError extends Error {
  constructor(readonly code: "RING_ENCRYPT_FAILED" | "RECOVERY_FAILED", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WalletCliError";
  }
}

export type WalletCliRunner = (args: string[], input: Buffer, env: Record<string, string>) => Promise<void>;

const defaultRunWalletCli: WalletCliRunner = (args, input, env) =>
  new Promise((resolve, reject) => {
    const child = spawn("wallet-cli", args, { env, stdio: ["pipe", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => reject(new WalletCliError("RING_ENCRYPT_FAILED", "wallet-cli could not start", { cause: error })));
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new WalletCliError("RING_ENCRYPT_FAILED", `wallet-cli ring encrypt exited with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolve();
    });
    child.stdin.end(input);
  });

async function encryptPayload(input: {
  key: string;
  payload: unknown;
  outputPath: string;
  walletPass: WalletPassProvider;
  runWalletCli?: WalletCliRunner;
}): Promise<void> {
  const pass = await input.walletPass();
  if (!pass) throw new WalletCliError("RING_ENCRYPT_FAILED", "wallet password was unavailable");
  await (input.runWalletCli ?? defaultRunWalletCli)(
    ["ring", "encrypt", "--key", input.key, "-o", input.outputPath],
    Buffer.from(JSON.stringify(input.payload), "utf8"),
    { PATH: process.env.PATH ?? "", WALLET_PASS: pass },
  );
}

/**
 * Seals `{ brokerSessionKey, spendAccountId, brokerUaid }` with
 * `wallet-cli ring encrypt --key broker:<brokerId>`. WALLET_PASS is read from
 * an already-provisioned OS keychain lookup by the caller (never typed or
 * chosen here) and passed through only via the child process environment -
 * it is never logged or included in the command line.
 */
export async function sealBrokerBundle(input: {
  brokerId: string;
  bundle: BrokerBundle;
  outputPath: string;
  walletPass: WalletPassProvider;
  runWalletCli?: WalletCliRunner;
}): Promise<void> {
  const bundle = brokerBundleSchema.parse(input.bundle);
  await encryptPayload({ key: `broker:${input.brokerId}`, payload: bundle, outputPath: input.outputPath, walletPass: input.walletPass, runWalletCli: input.runWalletCli });
}

/** Encrypts the fresh key before any funding transaction is requested. */
export async function sealPendingBrokerBundle(input: {
  brokerId: string;
  bundle: PendingBrokerBundle;
  outputPath: string;
  walletPass: WalletPassProvider;
  runWalletCli?: WalletCliRunner;
}): Promise<void> {
  const bundle = pendingBrokerBundleSchema.parse(input.bundle);
  await encryptPayload({ key: `broker:${input.brokerId}:pending`, payload: bundle, outputPath: input.outputPath, walletPass: input.walletPass, runWalletCli: input.runWalletCli });
}

export async function recoverPendingBrokerBundle(input: {
  brokerId: string;
  bundlePath: string;
  walletPass: WalletPassProvider;
}): Promise<PendingBrokerBundle> {
  const ciphertext = await readFile(input.bundlePath);
  const plaintext = await decryptKeyRingBundle(ciphertext, `broker:${input.brokerId}:pending`, input.walletPass);
  return pendingBrokerBundleSchema.parse(JSON.parse(plaintext.toString("utf8")));
}

/**
 * Recovery test (user story 5): decrypts the just-sealed bundle straight back
 * and confirms it parses to the expected shape, without ever surfacing the
 * plaintext. Reuses vault-worker's Key Ring decrypt seam - the same one the
 * running broker will use - rather than a second, divergent decrypt path.
 */
export async function verifyBrokerBundleRecovery(input: {
  brokerId: string;
  bundlePath: string;
  walletPass: WalletPassProvider;
}): Promise<boolean> {
  let ciphertext: Buffer;
  try {
    ciphertext = await readFile(input.bundlePath);
  } catch (error) {
    throw new WalletCliError("RECOVERY_FAILED", "sealed bundle file could not be read back", { cause: error });
  }
  const plaintext = await decryptKeyRingBundle(ciphertext, `broker:${input.brokerId}`, input.walletPass);
  const parsed = brokerBundleSchema.safeParse(JSON.parse(plaintext.toString("utf8")));
  return parsed.success;
}

/** Internal migration/finalization seam. Callers must never log the result. */
export async function recoverBrokerBundle(input: {
  brokerId: string;
  bundlePath: string;
  walletPass: WalletPassProvider;
}): Promise<BrokerBundle> {
  const ciphertext = await readFile(input.bundlePath);
  const plaintext = await decryptKeyRingBundle(ciphertext, `broker:${input.brokerId}`, input.walletPass);
  return brokerBundleSchema.parse(JSON.parse(plaintext.toString("utf8")));
}
