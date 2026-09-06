import { describe, expect, it } from "vitest";
import { hashCanonicalJson } from "@finity/schemas";
import { compile } from "@finity/mandate-compiler";
import { evaluate, POLICY_HASH, REASON_CODES } from "./index.js";

const manifest = {
  kind: "finity.manifest" as const,
  version: 1 as const,
  serviceId: "hello-weather@1",
  provider: { uaid: "did:aid:provider", hederaAccount: "0.0.789", signingKey: "provider-key" },
  name: "Hello Weather",
  description: "Current conditions by city.",
  baseUrl: "https://weather.example.test",
  methods: [{ id: "GET:/weather", inputSchemaRef: "weather-input", outputSchemaRef: "weather-output", dataClassMax: 0 }],
  pricing: { model: "fixed" as const, unit: "call" as const, asset: "0.0.0" as const, network: "hedera:testnet" as const },
  quoteEndpoint: "/quote",
  payTo: "0.0.789",
  receiptKey: "receipt-key",
  healthEndpoint: "/health",
  publishedAt: 1788739200,
  signature: `0x${"b".repeat(130)}`,
};

const mandate = compile({
  agent: "did:aid:buyer",
  broker: "0x1111111111111111111111111111111111111111",
  spendAccount: "0.0.123",
  allowedServices: "hello-weather@1",
  allowedMethods: "GET:/weather",
  asset: "HBAR",
  maxPerRequest: "5000000",
  maxPerPeriod: "500000000",
  periodSeconds: "86400",
  maxLifetime: "2000000000",
  maxUnitsPerRequest: "0",
  validFrom: 1788739200,
  validUntil: 1790208000,
  quoteMaxAgeSeconds: "120",
  dataClass: 0,
  escalationRule: "anything above per-request cap needs my Ledger",
  policyHash: POLICY_HASH,
  nonce: "1",
  predecessor: "0x0000000000000000000000000000000000000000000000000000000000000000",
  verifyingContract: "0x2222222222222222222222222222222222222222",
}).canonicalMandate;

const unsignedManifestHash = hashCanonicalJson((( { signature: _signature, ...rest } ) => rest)(manifest));
const quote = {
  kind: "finity.quote" as const,
  serviceId: "hello-weather@1",
  methodId: "GET:/weather",
  manifestHash: unsignedManifestHash,
  requestClass: { unit: "call" as const, units: "1" },
  amount: "5000000",
  asset: "0.0.0" as const,
  network: "hedera:testnet" as const,
  payTo: "0.0.789",
  nonce: "00000000-0000-4000-8000-000000000001",
  issuedAt: 1788739210,
  expiresAt: 1788739300,
  signature: `0x${"c".repeat(130)}`,
};

const snapshot = {
  mandate,
  mandateStatus: "ACTIVE" as const,
  mandateSuperseded: false,
  principal: "0x3333333333333333333333333333333333333333",
  signatureValid: true,
  displayValid: true,
  agentUaid: "did:aid:buyer",
  brokerAddress: mandate.broker,
  providerAllowed: true,
  providerAccount: "0.0.789",
  serviceId: "hello-weather@1",
  methodId: "GET:/weather",
  quote,
  manifest,
  manifestSignatureValid: true,
  quoteSignatureValid: true,
  quoteNonceReused: false,
  requestDataClass: 0,
  policyHash: POLICY_HASH,
  currentPeriodConsumed: "0",
  currentLifetimeConsumed: "0",
  now: 1788739220,
  revocationActive: false,
};

describe("policy engine", () => {
  it("authorizes a valid snapshot", () => {
    const result = evaluate(snapshot);
    expect(result.decision).toBe("AUTHORIZED");
    expect(result.reasonCodes).toEqual([]);
    expect(result.reservationRequest).toEqual({ amount: "5000000" });
  });

  it.each([
    ["MANDATE_INACTIVE", { mandateStatus: "REVOKED" }],
    ["MANDATE_EXPIRED", { now: 1790208000 }],
    ["MANDATE_SUPERSEDED", { mandateSuperseded: true }],
    ["SIGNATURE_INVALID", { signatureValid: false }],
    ["DISPLAY_MISMATCH", { displayValid: false }],
    ["AGENT_MISMATCH", { agentUaid: "did:aid:other" }],
    ["BROKER_NOT_AUTHORIZED", { brokerAddress: "0x4444444444444444444444444444444444444444" }],
    ["PROVIDER_NOT_ALLOWED", { providerAllowed: false }],
    ["SERVICE_NOT_ALLOWED", { serviceId: "other@1" }],
    ["METHOD_NOT_ALLOWED", { methodId: "POST:/other" }],
    ["ASSET_NOT_ALLOWED", { quote: { ...quote, asset: "0.0.999" } }],
    ["QUOTE_INVALID", { quoteSignatureValid: false }],
    ["QUOTE_EXPIRED", { quote: { ...quote, expiresAt: 1788739219 } }],
    ["PAYMENT_TERMS_MISMATCH", { quote: { ...quote, payTo: "0.0.790" } }],
    ["PRICE_LIMIT_EXCEEDED", { quote: { ...quote, amount: "5000001" } }],
    ["UNIT_LIMIT_EXCEEDED", { mandate: { ...mandate, maxUnitsPerRequest: "1" }, quote: { ...quote, requestClass: { unit: "call" as const, units: "2" } } }],
    ["PERIOD_BUDGET_EXCEEDED", { currentPeriodConsumed: "495000001" }],
    ["LIFETIME_BUDGET_EXCEEDED", { currentLifetimeConsumed: "1995000001" }],
    ["DATA_POLICY_VIOLATION", { requestDataClass: 1 }],
    ["POLICY_VERSION_MISMATCH", { policyHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" }],
    ["REVOCATION_ACTIVE", { revocationActive: true }],
  ] as const)("returns %s", (code, change) => {
    const result = evaluate({ ...snapshot, ...change });
    expect(result.reasonCodes).toContain(code);
  });

  it("escalates only limit failures and proposes an amendment", () => {
    const result = evaluate({ ...snapshot, quote: { ...quote, amount: "5000001" } });
    expect(result.decision).toBe("ESCALATION_REQUIRED");
    expect(result.proposedAmendment?.oneTime).toBe(true);
  });

  it("refuses malformed state fail-closed", () => {
    const result = evaluate({});
    expect(result).toMatchObject({ decision: "REFUSED", reasonCodes: ["STATE_UNAVAILABLE"] });
  });

  it("is deterministic", () => {
    const outputs = Array.from({ length: 1000 }, () => JSON.stringify(evaluate(snapshot)));
    expect(new Set(outputs).size).toBe(1);
    expect(REASON_CODES).toContain("CAPABILITY_REPLAY");
  });
});

