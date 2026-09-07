import { readFileSync } from "node:fs";
import { compile } from "@finity/mandate-compiler";
import { POLICY_HASH } from "@finity/policy-engine";
import { createIntentExecutor, createLiveDependencies, MandateStore, type Intent, type Purchase } from "@finity/finityd";
import { PrivateKey } from "@x402/hedera";

/**
 * Runs one real F4 autonomous-purchase pipeline against Hedera testnet.
 *
 * `pnpm finityd intent --file fixtures/intent-weather.json [--mandate fixtures/mandate-weather.json]`
 *
 * Requires FINITY_TESTNET=1 plus funded credentials and a mandate already
 * registered on-chain with a real Ledger-produced signature (Day 4). The
 * checked-in mandate fixture carries a placeholder signature and will be
 * rejected by MandateRegistry.registerMandate; it exists to exercise this
 * pipeline's shape locally once a real registration is available.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function flag(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index === -1 || index === args.length - 1 ? fallback : (args[index + 1] ?? fallback);
}

if (process.env.FINITY_TESTNET !== "1") {
  throw new Error("refusing to spend HBAR: set FINITY_TESTNET=1 after reviewing the mandate, quote, and account configuration");
}

const intentPath = flag("--file", "fixtures/intent-weather.json");
const mandatePath = flag("--mandate", "fixtures/mandate-weather.json");
const intentFixture = JSON.parse(readFileSync(intentPath, "utf8")) as Omit<Intent, "mandateId">;
const mandateFixture = JSON.parse(readFileSync(mandatePath, "utf8")) as Record<string, unknown>;

const brokerAddress = required("FINITY_BROKER_EVM_ADDRESS") as `0x${string}`;
const brokerSessionKey = required("FINITY_BROKER_SESSION_KEY");
const brokerEvmPrivateKey = `0x${PrivateKey.fromStringECDSA(brokerSessionKey).toStringRaw()}` as `0x${string}`;
const spendAccountId = required("FINITY_SPEND_ACCOUNT_ID");
const registryAddress = required("FINITY_REGISTRY_ADDRESS");
const now = Math.floor(Date.now() / 1000);

// broker/spendAccount/policyHash/verifyingContract/validity are deployment-
// and-policy-version specific: trusting stale checked-in values would either
// silently sign against the wrong contract or drift from the live policy.
const compiled = compile({
  ...mandateFixture,
  broker: brokerAddress,
  spendAccount: spendAccountId,
  policyHash: POLICY_HASH,
  validFrom: now - 3600,
  validUntil: now + 3600 * 24 * 365,
  verifyingContract: registryAddress,
} as unknown as Parameters<typeof compile>[0]);
const mandateId = compiled.mandateId;
const mandateStore = new MandateStore();
mandateStore.set(mandateId, { ...compiled.canonicalMandate, signature: mandateFixture.signature as string, mandateId });

const deps = createLiveDependencies({
  mandateStore,
  registryAddress,
  registryTopicId: required("FINITY_REGISTRY_TOPIC_ID"),
  rpcUrl: process.env.FINITY_RPC_URL,
  mirrorNodeUrl: process.env.FINITY_MIRROR_NODE_URL,
  brokerAddress,
  brokerEvmPrivateKey,
  spendAccountId,
  brokerSessionKey,
  hederaOperatorId: required("HEDERA_OPERATOR_ID"),
  hederaOperatorKey: required("HEDERA_OPERATOR_KEY"),
});

const purchase: Purchase = {
  correlationId: crypto.randomUUID(),
  state: "INTENT",
  intent: { ...intentFixture, mandateId },
  updatedAt: now,
};

let final = purchase;
await createIntentExecutor(deps)(purchase, (event, extra) => {
  final = { ...final, state: event.type as Purchase["state"], ...extra };
  console.error(JSON.stringify({ event: event.type }));
  return final;
});

console.log(JSON.stringify({ correlationId: purchase.correlationId, mandateId, finalState: final.state, result: final.result, refusal: final.refusal }, null, 2));
