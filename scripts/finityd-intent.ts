import { readFileSync } from "node:fs";
import { compile } from "@finity/mandate-compiler";
import { POLICY_HASH } from "@finity/policy-engine";
import {
  createIntentExecutor,
  MandateStore,
  type Intent,
  type Purchase,
  type PurchaseDependencies,
} from "@finity/finityd";
import { createHcsWriter, createRegistryClient, mandateRegistryAbi, type RegistryClient } from "@finity/registry-client";
import { PrivateKey } from "@x402/hedera";
import { decodeEventLog, type Hash } from "viem";
import { sign } from "viem/accounts";

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
const brokerEvmPrivateKey = `0x${PrivateKey.fromString(brokerSessionKey).toStringRaw()}` as `0x${string}`;
const spendAccountId = required("FINITY_SPEND_ACCOUNT_ID");
const registryAddress = required("FINITY_REGISTRY_ADDRESS");
const registryTopicId = required("FINITY_REGISTRY_TOPIC_ID");
const rpcUrl = process.env.FINITY_RPC_URL;
const mirrorNodeUrl = process.env.FINITY_MIRROR_NODE_URL;
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
const mandate = { ...compiled.canonicalMandate, signature: mandateFixture.signature as string, mandateId };

const mandateStore = new MandateStore();
mandateStore.set(mandateId, mandate);

const registryClient: RegistryClient = createRegistryClient({
  contractAddress: registryAddress,
  rpcUrl,
  privateKey: brokerEvmPrivateKey,
});

async function reserveOnChain(id: Hash, amountTinybar: string): Promise<Hash> {
  const txHash = await registryClient.reserve(id, amountTinybar);
  const receipt = await registryClient.publicClient.waitForTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: mandateRegistryAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "ReservationCreated") return (decoded.args as { reservationId: Hash }).reservationId;
    } catch {
      continue;
    }
  }
  throw new Error("reserve() did not emit a ReservationCreated event");
}

// Demo-only: ServiceManifest has no client-facing resource path, only
// quoteEndpoint/healthEndpoint, so the paid HTTP path per method is not
// derivable from the manifest today. A real buyer skill (Day 4) would also
// need to turn the intent's payloadRef into real request query/body data;
// neither gap is resolved here.
const RESOURCE_PATHS: Record<string, string> = {
  "hello-weather@1:weather.current": "/weather?city=Kolkata",
  "summarize-lite@1:summarize.text": "/summarize",
};

const signBrokerHash = async (commitment: Hash): Promise<`0x${string}`> => sign({ hash: commitment, privateKey: brokerEvmPrivateKey, to: "hex" });

const hcsWriter = mirrorNodeUrl
  ? undefined
  : createHcsWriter({ network: "hedera:testnet", operatorId: required("HEDERA_OPERATOR_ID"), privateKey: required("HEDERA_OPERATOR_KEY") });

const deps: PurchaseDependencies = {
  mandateStore,
  now: () => Math.floor(Date.now() / 1000),
  topicId: registryTopicId,
  mirrorNodeUrl,
  registryRecord: (id) => registryClient.readRecord(id),
  reserve: reserveOnChain,
  finalize: async (reservationId, actual) => {
    await registryClient.publicClient.waitForTransactionReceipt({ hash: await registryClient.finalize(reservationId, actual) });
  },
  release: async (reservationId) => {
    await registryClient.publicClient.waitForTransactionReceipt({ hash: await registryClient.release(reservationId) });
  },
  // Real signature verification for the mandate/quote/manifest is not yet
  // decided anywhere in this codebase (that is @finity/verifier's job), so
  // this snapshot trusts them unconditionally rather than inventing a scheme.
  buildSnapshot: (input) => {
    const { signature: _signature, mandateId: _mandateId, ...agentMandate } = input.mandate;
    const statusByCode = ["NONE", "ACTIVE", "EXHAUSTED", "EXPIRED", "REVOKED", "SUPERSEDED"] as const;
    return {
      mandate: agentMandate,
      mandateStatus: statusByCode[input.registryRecord.status] ?? "NONE",
      mandateSuperseded: input.registryRecord.successor !== `0x${"00".repeat(32)}`,
      principal: input.registryRecord.principal,
      signatureValid: true,
      displayValid: true,
      agentUaid: input.mandate.agent,
      brokerAddress: input.mandate.broker,
      providerAllowed: true,
      providerAccount: input.manifest.provider.hederaAccount,
      serviceId: input.manifest.serviceId,
      methodId: input.quote.methodId,
      quote: input.quote,
      manifest: input.manifest,
      manifestSignatureValid: true,
      quoteSignatureValid: true,
      quoteNonceReused: false,
      requestDataClass: input.requestDataClass,
      policyHash: POLICY_HASH,
      currentPeriodConsumed: input.registryRecord.periodConsumed,
      currentLifetimeConsumed: input.registryRecord.lifetimeConsumed,
      now: input.now,
      revocationActive: false,
    };
  },
  signCapability: signBrokerHash,
  signReceipt: signBrokerHash,
  resourceUrl: (manifest, methodId) => {
    const path = RESOURCE_PATHS[`${manifest.serviceId}:${methodId}`];
    if (!path) throw new Error(`no known resource path for ${manifest.serviceId}:${methodId}`);
    return `${manifest.baseUrl}${path}`;
  },
  spendAccountId,
  brokerSessionKey,
  brokerAddress,
  parseChallenges: async (response) => {
    const body = (await response.clone().json()) as { accepts?: unknown[] };
    if (!Array.isArray(body.accepts)) throw new Error("402 response did not include an accepts array");
    return body.accepts as never;
  },
  submitTrace: async (envelope) => {
    const record = await registryClient.readRecord(mandateId);
    if (!record.traceTopic) {
      console.error(JSON.stringify({ note: "mandate has no trace topic set on-chain; skipping HCS submit", envelope }));
      return undefined;
    }
    const writer = hcsWriter ?? createHcsWriter({ network: "hedera:testnet", operatorId: required("HEDERA_OPERATOR_ID"), privateKey: required("HEDERA_OPERATOR_KEY") });
    return writer.submitMessage(record.traceTopic, envelope);
  },
};

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
