import { describe, expect, it } from "vitest";
import { compile } from "@finity/mandate-compiler";
import { POLICY_HASH } from "@finity/policy-engine";
import { hashCanonicalJson, type Hash, type HcsEnvelope, type PolicySnapshot, type PurchaseEvent, type ServiceManifest, type SignedAgentMandate } from "@finity/schemas";
import type { RegistryRecord } from "@finity/registry-client";
import { createIntentExecutor, MandateStore, type PurchaseDependencies, type SnapshotInput } from "./executor.js";
import type { Intent, Purchase } from "./index.js";

// Derived from the real clock, not a fixed historical constant: commerce-adapter's
// paidFetch checks capability expiry against actual Date.now(), independent of the
// fake `now` injected into the policy snapshot, so both clocks must agree it is live.
const now = Math.floor(Date.now() / 1000);
const validFrom = now - 3600;
const validUntil = now + 3600 * 24 * 365;

const broker = "0x1111111111111111111111111111111111111111" as const;
const compiled = compile({
  agent: "did:aid:buyer",
  broker,
  spendAccount: "0.0.123",
  allowedServices: "hello-weather@1",
  allowedMethods: "weather.current",
  asset: "HBAR",
  maxPerRequest: "5000000",
  maxPerPeriod: "500000000",
  periodSeconds: "86400",
  maxLifetime: "2000000000",
  maxUnitsPerRequest: "0",
  validFrom,
  validUntil,
  quoteMaxAgeSeconds: "120",
  dataClass: 0,
  escalationRule: "anything above per-request cap needs my Ledger",
  policyHash: POLICY_HASH,
  nonce: "1",
  predecessor: `0x${"00".repeat(32)}`,
  verifyingContract: "0x2222222222222222222222222222222222222222",
});
const mandateId = compiled.mandateId;
const mandate: SignedAgentMandate = { ...compiled.canonicalMandate, signature: `0x${"aa".repeat(65)}`, mandateId };

const unsignedManifest = {
  kind: "finity.manifest" as const, version: 1 as const, serviceId: "hello-weather@1",
  provider: { uaid: "did:aid:provider", hederaAccount: "0.0.789", signingKey: "provider-key" },
  name: "Hello Weather", description: "Current conditions.", baseUrl: "https://weather.example.test",
  methods: [{ id: "weather.current", inputSchemaRef: "in", outputSchemaRef: "out", dataClassMax: 0 }],
  pricing: { model: "fixed" as const, unit: "call" as const, asset: "0.0.0" as const, network: "hedera:testnet" as const },
  quoteEndpoint: "/quote", payTo: "0.0.789", receiptKey: "receipt-key", healthEndpoint: "/health",
  publishedAt: validFrom,
};
const manifest: ServiceManifest = { ...unsignedManifest, signature: `0x${"bb".repeat(65)}` };
const manifestHash = hashCanonicalJson(unsignedManifest);

const quote = {
  kind: "finity.quote" as const, serviceId: "hello-weather@1", methodId: "weather.current", manifestHash,
  requestClass: { unit: "call" as const, units: "1" }, amount: "5000000", asset: "0.0.0" as const,
  network: "hedera:testnet" as const, payTo: "0.0.789", nonce: "00000000-0000-4000-8000-000000000001",
  issuedAt: now, expiresAt: now + 60, signature: `0x${"cc".repeat(65)}`,
};

const activeRegistryRecord: RegistryRecord = {
  principal: "0x3333333333333333333333333333333333333333",
  broker,
  policyHash: POLICY_HASH,
  limits: { maxPerRequest: "5000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000", validFrom: String(validFrom), validUntil: String(validUntil) },
  lifetimeConsumed: "0",
  periodIndex: "0",
  periodConsumed: "0",
  reserved: "0",
  status: 1,
  successor: `0x${"00".repeat(32)}` as Hash,
  traceTopic: "",
};

function baseSnapshot(input: SnapshotInput): PolicySnapshot {
  const { signature: _signature, mandateId: _mandateId, ...agentMandate } = input.mandate;
  return {
    mandate: agentMandate,
    mandateStatus: input.registryRecord.status === 1 ? "ACTIVE" : "EXPIRED",
    mandateSuperseded: false,
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
}

function mirrorFetcher(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        messages: [{
          consensus_timestamp: "1.0", sequence_number: 1,
          message: Buffer.from(JSON.stringify(manifest), "utf8").toString("base64"),
          running_hash: null, transaction_id: null,
        }],
        links: { next: null },
      }),
      { status: 200 },
    )) as typeof fetch;
}

function makeDeps(overrides: Partial<PurchaseDependencies> = {}): PurchaseDependencies {
  const mandateStore = new MandateStore();
  mandateStore.set(mandateId, mandate);
  return {
    mandateStore,
    now: () => now,
    topicId: "0.0.1",
    mirrorFetcher: mirrorFetcher(),
    quoteFetcher: (async () => new Response(JSON.stringify(quote), { status: 200 })) as typeof fetch,
    registryRecord: async () => activeRegistryRecord,
    reserve: async () => `0x${"dd".repeat(32)}` as Hash,
    finalize: async () => undefined,
    release: async () => undefined,
    buildSnapshot: baseSnapshot,
    signCapability: async () => `0x${"11".repeat(65)}` as `0x${string}`,
    signReceipt: async () => `0x${"22".repeat(65)}` as `0x${string}`,
    resourceUrl: (candidateManifest) => `${candidateManifest.baseUrl}/weather`,
    spendAccountId: "0.0.123",
    brokerSessionKey: "unused-in-fake-fetch-path",
    brokerAddress: broker,
    parseChallenges: async () => {
      throw new Error("parseChallenges should not run when the provider never returns 402");
    },
    fetchImpl: (async () => new Response(JSON.stringify({ city: "Kolkata", condition: "clear" }), { status: 200 })) as typeof fetch,
    ...overrides,
  };
}

function makeIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    mandateId, agentUaid: "did:aid:buyer", requestClass: { unit: "call", units: "1" },
    payloadRef: "ref://1", dataClass: 0, methodId: "weather.current",
    ...overrides,
  };
}

function makePurchase(intent: Intent): Purchase {
  return { correlationId: "00000000-0000-4000-8000-000000000001", state: "INTENT", intent, updatedAt: now };
}

/** Drives runPurchase with a reducer-faithful transition function and records every event/extra pair. */
function drive(deps: PurchaseDependencies, intent: Intent): { events: { type: string; extra?: unknown }[]; run: Promise<void> } {
  const events: { type: string; extra?: unknown }[] = [];
  const purchase = makePurchase(intent);
  const executor = createIntentExecutor(deps);
  const transition = (event: PurchaseEvent, extra?: Pick<Purchase, "result" | "refusal">) => {
    events.push({ type: event.type, extra });
    return purchase;
  };
  return { events, run: executor(purchase, transition) };
}

describe("MandateStore", () => {
  it("returns undefined for an unknown mandate and throws recording a receipt for it", () => {
    const store = new MandateStore();
    expect(store.get(mandateId)).toBeUndefined();
    expect(() => store.recordReceiptHash(mandateId, `0x${"01".repeat(32)}` as Hash)).toThrow("mandate not found");
  });

  it("starts a mandate's hash chain at the zero hash and updates it", () => {
    const store = new MandateStore();
    store.set(mandateId, mandate);
    expect(store.get(mandateId)?.lastReceiptHash).toBe(`0x${"00".repeat(32)}`);
    store.recordReceiptHash(mandateId, `0x${"01".repeat(32)}` as Hash);
    expect(store.get(mandateId)?.lastReceiptHash).toBe(`0x${"01".repeat(32)}`);
  });
});

describe("createIntentExecutor", () => {
  it("runs the full F4 pipeline to RECONCILED and hash-chains a trace envelope per step", async () => {
    const envelopes: HcsEnvelope[] = [];
    const deps = makeDeps({ submitTrace: async (envelope) => { envelopes.push(envelope); return undefined; } });
    const { events, run } = drive(deps, makeIntent());
    await run;

    expect(events.map((event) => event.type)).toEqual([
      "DISCOVERED", "QUOTED", "EVALUATING", "AUTHORIZED", "RESERVED", "PAID", "DELIVERED", "RECONCILED",
    ]);
    expect(events.find((event) => event.type === "DELIVERED")?.extra).toMatchObject({ result: { city: "Kolkata" } });
    expect(envelopes.map((envelope) => envelope.t)).toEqual(["DECISION", "PAYMENT", "USAGE", "RECONCILED"]);
    for (let i = 1; i < envelopes.length; i += 1) {
      expect(envelopes[i]?.p).toBe(envelopes[i - 1]?.h);
    }
    expect(deps.mandateStore.get(mandateId)?.lastReceiptHash).toBe(envelopes.at(-1)?.h);
  });

  it("stops at FAILED_DISCOVERY when the mandate is unknown", async () => {
    const deps = makeDeps();
    const { events, run } = drive(deps, makeIntent({ mandateId: `0x${"99".repeat(32)}` as Hash }));
    await run;
    expect(events.map((event) => event.type)).toEqual(["FAILED_DISCOVERY"]);
  });

  it("stops at FAILED_DISCOVERY when the registry topic has no allowed manifest", async () => {
    const deps = makeDeps({ mirrorFetcher: (async () => new Response(JSON.stringify({ messages: [], links: { next: null } }), { status: 200 })) as typeof fetch });
    const { events, run } = drive(deps, makeIntent());
    await run;
    expect(events.map((event) => event.type)).toEqual(["FAILED_DISCOVERY"]);
  });

  it("stops at FAILED_QUOTE when every provider quote request fails", async () => {
    const deps = makeDeps({ quoteFetcher: (async () => new Response("boom", { status: 500 })) as typeof fetch });
    const { events, run } = drive(deps, makeIntent());
    await run;
    expect(events.map((event) => event.type)).toEqual(["DISCOVERED", "FAILED_QUOTE"]);
  });

  it("refuses and stops before reservation when policy fails closed", async () => {
    const deps = makeDeps({ buildSnapshot: (input) => ({ ...baseSnapshot(input), providerAllowed: false }) });
    const { events, run } = drive(deps, makeIntent());
    await run;
    expect(events.map((event) => event.type)).toEqual(["DISCOVERED", "QUOTED", "EVALUATING", "REFUSED"]);
    const refused = events.find((event) => event.type === "REFUSED");
    expect(refused?.extra).toMatchObject({ refusal: { decision: "REFUSED", reasonCodes: ["PROVIDER_NOT_ALLOWED"] } });
  });

  it("escalates and stops before reservation when only a limit fails", async () => {
    const deps = makeDeps({ buildSnapshot: (input) => ({ ...baseSnapshot(input), quote: { ...input.quote, amount: "5000001" } }) });
    const { events, run } = drive(deps, makeIntent());
    await run;
    expect(events.map((event) => event.type)).toEqual(["DISCOVERED", "QUOTED", "EVALUATING", "ESCALATION_REQUIRED"]);
  });

  it("releases the reservation and stops at FAILED_PAYMENT when the provider never settles", async () => {
    const deps = makeDeps({ fetchImpl: (async () => new Response("down", { status: 503 })) as typeof fetch });
    let released: Hash | undefined;
    deps.release = async (reservationId) => { released = reservationId; };
    const { events, run } = drive(deps, makeIntent());
    await run;
    expect(events.map((event) => event.type)).toEqual(["DISCOVERED", "QUOTED", "EVALUATING", "AUTHORIZED", "RESERVED", "FAILED_PAYMENT"]);
    expect(released).toBe(`0x${"dd".repeat(32)}`);
  });
});
