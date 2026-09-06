import { describe, expect, it } from "vitest";
import { compile, formatDisplay } from "./index.js";

const base = {
  agent: "did:aid:buyer",
  broker: "0x1111111111111111111111111111111111111111",
  spendAccount: "0.0.123",
  allowedServices: "hello-weather@1",
  allowedMethods: "GET:/weather",
  asset: "HBAR" as const,
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
  policyHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  nonce: "1",
  predecessor: "0x0000000000000000000000000000000000000000000000000000000000000000",
  verifyingContract: "0x2222222222222222222222222222222222222222",
};

describe("compile", () => {
  it.each([
    ["weather", base],
    ["small-cap", { ...base, maxPerRequest: "1000000", maxLifetime: "100000000" }],
    ["two-services", { ...base, allowedServices: "hello-weather@1,summarize-lite@1", allowedMethods: "GET:/weather,POST:/summarize" }],
  ])("produces a stable mandate for %s", (_, choices) => {
    const result = compile(choices);
    expect(result.mandateId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.canonicalMandate.maxPerRequestText).toBe(formatDisplay(choices.maxPerRequest, choices.asset));
    expect(result.canonicalMandate.maxPerPeriodText).toBe("5.00 HBAR per 24h");
    expect(result.canonicalMandate.maxLifetimeText).toContain("HBAR total");
    expect(result.typedData.message.maxPerRequest).toBe(BigInt(choices.maxPerRequest));
  });

  it("rejects a display value that does not match its numeric twin", () => {
    expect(() => compile({ ...base, maxPerRequestText: "0.01 HBAR" })).toThrow("maxPerRequestText");
  });

  it("rejects more than five services", () => {
    expect(() => compile({ ...base, allowedServices: "a,b,c,d,e,f" })).toThrow("at most five");
  });
});

