#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { decryptKeyRingBundle } from "@finity/vault-worker";
import { brokerBundleSchema, signedAgentMandateSchema, type Hash } from "@finity/schemas";
import { privateKeyToAccount } from "viem/accounts";
import { createIntentExecutor } from "./executor.js";
import { MandateStore, PurchaseStore, startFinityd } from "./index.js";
import { createLiveDependencies } from "./live-dependencies.js";

/**
 * Long-running finityd: loads locally registered mandates and the sealed
 * Broker Bundle, starts the HTTP API with a real executor wired to Hedera
 * testnet, and writes its {baseUrl, token} for other local processes (the
 * finity wrapper bin, the Pi extension's tools) to find.
 *
 * Per FINITY_BUILD_SPEC.md section 7.1's explicit hackathon allowance,
 * this process plays both "Process B" (finityd) and "Process C"
 * (vault-worker) roles - it decrypts the Broker Bundle itself rather than
 * over a worker_thread boundary. The hard rule that invariant preserves
 * (the Buyer Agent, "Process A", is a separate OS process that never sees
 * plaintext) still holds: the Pi extension only ever talks to this daemon
 * over localhost HTTP with a bearer token, never sees the decrypted bundle.
 */

function finityHome(): string {
  return process.env.FINITY_HOME ?? join(homedir(), ".finity");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function loadMandates(mandateStore: MandateStore): Promise<number> {
  const dir = join(finityHome(), "mandates");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  let loaded = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, entry), "utf8"));
    } catch {
      continue;
    }
    const parsed = signedAgentMandateSchema.safeParse(raw);
    if (!parsed.success) continue;
    mandateStore.set(parsed.data.mandateId as Hash, parsed.data);
    loaded += 1;
  }
  return loaded;
}

async function loadBrokerBundle(): Promise<{ brokerSessionKey: `0x${string}`; spendAccountId: string; brokerUaid: string }> {
  const bundlePath = join(finityHome(), "bundles", "broker.enc");
  if (!process.env.WALLET_PASS) throw new Error("WALLET_PASS is required to start finityd; set it from the OS keychain before launching the broker");
  const ciphertext = await readFile(bundlePath);
  const plaintext = await decryptKeyRingBundle(ciphertext, "broker:default", async () => process.env.WALLET_PASS ?? "");
  const bundle = brokerBundleSchema.parse(JSON.parse(plaintext.toString("utf8")));
  return { ...bundle, brokerSessionKey: bundle.brokerSessionKey as `0x${string}` };
}

async function main(): Promise<void> {
  const home = finityHome();
  const mandateStore = new MandateStore();
  const mandateCount = await loadMandates(mandateStore);

  const bundle = await loadBrokerBundle();
  const brokerAddress = privateKeyToAccount(bundle.brokerSessionKey).address;
  const registryTopicId = required("FINITY_REGISTRY_TOPIC_ID");

  const deps = createLiveDependencies({
    mandateStore,
    registryAddress: required("FINITY_REGISTRY_ADDRESS"),
    registryTopicId,
    rpcUrl: process.env.FINITY_RPC_URL,
    mirrorNodeUrl: process.env.FINITY_MIRROR_NODE_URL,
    brokerAddress,
    brokerEvmPrivateKey: bundle.brokerSessionKey,
    spendAccountId: bundle.spendAccountId,
    brokerSessionKey: bundle.brokerSessionKey,
    hederaOperatorId: required("HEDERA_OPERATOR_ID"),
    hederaOperatorKey: required("HEDERA_OPERATOR_KEY"),
  });

  const store = new PurchaseStore(join(home, "finityd.db"));
  const instance = startFinityd({
    store,
    executor: createIntentExecutor(deps),
    services: { mandateStore, topicId: registryTopicId, mirrorNodeUrl: process.env.FINITY_MIRROR_NODE_URL, registryRecord: deps.registryRecord },
    brokerAccount: deps.brokerAccount,
    mandateRegistration: { register: (mandate) => deps.registerMandate(mandate) },
    mandateRevocation: { revoke: (revocation, signature) => deps.revokeMandate(revocation, signature) },
    killSwitchPath: join(home, "kill-switch"),
    host: "127.0.0.1",
  });

  if (!instance.server.listening) await new Promise((resolve) => instance.server.once("listening", resolve));
  const address = instance.server.address();
  if (!address || typeof address === "string") throw new Error("finityd did not bind to a TCP port");

  await mkdir(home, { recursive: true });
  const runtimePath = join(home, "finityd.runtime.json");
  await writeFile(runtimePath, `${JSON.stringify({ baseUrl: `http://127.0.0.1:${address.port}`, token: instance.token }, null, 2)}\n`, "utf8");

  console.error(`finityd listening on 127.0.0.1:${address.port} with ${mandateCount} mandate(s) loaded; runtime info at ${runtimePath}`);

  process.on("SIGINT", () => void instance.close().then(() => process.exit(0)));
  process.on("SIGTERM", () => void instance.close().then(() => process.exit(0)));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
