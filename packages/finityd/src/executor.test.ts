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

  it("refuses and stops before reservation when policy fails closed, but still signs a receipt and commits a DECISION envelope", async () => {
    const envelopes: HcsEnvelope[] = [];
    const deps = makeDeps({
      buildSnapshot: (input) => ({ ...baseSnapshot(input), providerAllowed: false }),
      submitTrace: async (envelope) => { envelopes.push(envelope); return undefined; },
    });
    const { events, run } = drive(deps, makeIntent());
    await run;
    expect(events.map((event) => event.type)).toEqual(["DISCOVERED", "QUOTED", "EVALUATING", "REFUSED"]);
    const refused = events.find((event) => event.type === "REFUSED");
    expect(refused?.extra).toMatchObject({ refusal: { decision: "REFUSED", reasonCodes: ["PROVIDER_NOT_ALLOWED"] } });
    expect((refused?.extra as { refusal?: { receiptId?: string } } | undefined)?.refusal?.receiptId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(envelopes.map((envelope) => envelope.t)).toEqual(["DECISION"]);
    expect(envelopes[0]?.p).toBe(`0x${"00".repeat(32)}`);
    expect(deps.mandateStore.get(mandateId)?.lastReceiptHash).toBe(envelopes[0]?.h);
  });

  it("escalates and stops before reservation when only a limit fails, also signing a receipt", async () => {
    const deps = makeDeps({ buildSnapshot: (input) => ({ ...baseSnapshot(input), quote: { ...input.quote, amount: "5000001" } }) });
    const { events, run } = drive(deps, makeIntent());
    await run;
    expect(events.map((event) => event.type)).toEqual(["DISCOVERED", "QUOTED", "EVALUATING", "ESCALATION_REQUIRED"]);
    const escalated = events.find((event) => event.type === "ESCALATION_REQUIRED");
    expect((escalated?.extra as { refusal?: { receiptId?: string } } | undefined)?.refusal?.receiptId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("chains a second purchase's DECISION off the first purchase's, regardless of the first's outcome", async () => {
    const deps = makeDeps({ buildSnapshot: (input) => ({ ...baseSnapshot(input), providerAllowed: false }) });
    const first = drive(deps, makeIntent());
    await first.run;
    const afterFirstRefusal = deps.mandateStore.get(mandateId)?.lastReceiptHash;
    expect(afterFirstRefusal).not.toBe(`0x${"00".repeat(32)}`);

    deps.buildSnapshot = baseSnapshot;
    const envelopes: HcsEnvelope[] = [];
    deps.submitTrace = async (envelope) => { envelopes.push(envelope); return undefined; };
    const second = drive(deps, makeIntent());
    await second.run;
    expect(envelopes[0]?.t).toBe("DECISION");
    expect(envelopes[0]?.p).toBe(afterFirstRefusal);
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

// Matches FINITY_BUILD_SPEC.md step 17/19's exact Day 5 "done when" scenarios:
// 1 authorized, 2 refusals (PRICE_LIMIT_EXCEEDED -> escalation; SERVICE_NOT_ALLOWED
// -> terminal), 1 escalation approved then the purchase succeeds, 1 escalation
// rejected, 1 revocation after which finity_purchase returns MANDATE_INACTIVE.
describe("Day 5 boundary scenarios", () => {
  it("authorizes a valid purchase through to RECONCILED (the 1 authorized case)", async () => {
    const { events, run } = drive(makeDeps(), makeIntent());
    await run;
    expect(events.at(-1)?.type).toBe("RECONCILED");
  });

  it("SERVICE_NOT_ALLOWED refuses terminally - not escalatable, since it isn't a limit failure", async () => {
    const deps = makeDeps({ buildSnapshot: (input) => ({ ...baseSnapshot(input), mandate: { ...baseSnapshot(input).mandate, allowedServices: "other-service@1" } }) });
    const { events, run } = drive(deps, makeIntent());
    await run;
    expect(events.map((event) => event.type)).toEqual(["DISCOVERED", "QUOTED", "EVALUATING", "REFUSED"]);
    const refused = events.find((event) => event.type === "REFUSED");
    expect(refused?.extra).toMatchObject({ refusal: { decision: "REFUSED", reasonCodes: ["SERVICE_NOT_ALLOWED"] } });
  });

  it("PRICE_LIMIT_EXCEEDED escalates rather than refusing terminally", async () => {
    const deps = makeDeps({ buildSnapshot: (input) => ({ ...baseSnapshot(input), quote: { ...input.quote, amount: "5000001" } }) });
    const { events, run } = drive(deps, makeIntent());
    await run;
    const escalated = events.find((event) => event.type === "ESCALATION_REQUIRED");
    expect(escalated).toBeDefined();
    expect((escalated?.extra as { refusal?: { reasonCodes?: string[] } } | undefined)?.refusal?.reasonCodes).toEqual(["PRICE_LIMIT_EXCEEDED"]);
  });

  it("an approved escalation's successor mandate lets a retried purchase succeed", async () => {
    // Simulates what /finity escalations approve produces: a successor
    // mandate with only maxPerRequest raised, loaded into the MandateStore
    // the way POST /v1/mandates does after approveEscalation() signs and
    // registers it - this test is finityd-side only, no signing involved.
    const successorCompiled = compile({
      agent: "did:aid:buyer", broker, spendAccount: "0.0.123",
      allowedServices: "hello-weather@1", allowedMethods: "weather.current", asset: "HBAR",
      maxPerRequest: "6000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000",
      maxUnitsPerRequest: "0", validFrom, validUntil, quoteMaxAgeSeconds: "120", dataClass: 0,
      escalationRule: "anything above per-request cap needs my Ledger", policyHash: POLICY_HASH,
      nonce: "2", predecessor: mandateId, verifyingContract: "0x2222222222222222222222222222222222222222",
    });
    const successorMandateId = successorCompiled.mandateId;
    const successorMandate: SignedAgentMandate = { ...successorCompiled.canonicalMandate, signature: `0x${"aa".repeat(65)}`, mandateId: successorMandateId };

    const deps = makeDeps({
      buildSnapshot: (input) => ({ ...baseSnapshot(input), quote: { ...input.quote, amount: "5000001" } }),
    });
    const first = drive(deps, makeIntent());
    await first.run;
    expect(first.events.at(-1)?.type).toBe("ESCALATION_REQUIRED");

    deps.mandateStore.set(successorMandateId, successorMandate);
    deps.buildSnapshot = baseSnapshot;
    const second = drive(deps, makeIntent({ mandateId: successorMandateId }));
    await second.run;
    expect(second.events.at(-1)?.type).toBe("RECONCILED");
  });

  it("a revoked mandate refuses with MANDATE_INACTIVE (the revocation case)", async () => {
    const revokedRecord: RegistryRecord = { ...activeRegistryRecord, status: 4 };
    const deps = makeDeps({ registryRecord: async () => revokedRecord });
    const { events, run } = drive(deps, makeIntent());
    await run;
    const refused = events.find((event) => event.type === "REFUSED");
    expect(refused).toBeDefined();
    expect((refused?.extra as { refusal?: { reasonCodes?: string[] } } | undefined)?.refusal?.reasonCodes).toContain("MANDATE_INACTIVE");
  });
});
