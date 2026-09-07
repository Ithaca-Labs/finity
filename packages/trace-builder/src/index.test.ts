import { describe, expect, it } from "vitest";
import { hashCanonicalJson, type DecisionReceipt } from "@finity/schemas";
import { assertTraceLink, buildEnvelope, receiptHash } from "./index.js";

const mandateId = `0x${"01".repeat(32)}` as const;
const zeroHash = `0x${"00".repeat(32)}` as const;

const decision: Omit<DecisionReceipt, "brokerSignature"> = {
  kind: "finity.decision",
  receiptId: `0x${"05".repeat(32)}`,
  correlationId: "00000000-0000-4000-8000-000000000001",
  mandateId,
  mandateVersion: "1",
  decision: "AUTHORIZED",
  reasonCodes: [],
  inputCommitment: `0x${"06".repeat(32)}`,
  policyHash: `0x${"07".repeat(32)}`,
  quoteHash: `0x${"08".repeat(32)}`,
  manifestHash: `0x${"09".repeat(32)}`,
  evaluatedLimits: {
    perRequest: { limit: "5000000", requested: "5000000" },
    period: { limit: "500000000", requested: "5000000", consumed: "0" },
    lifetime: { limit: "2000000000", requested: "5000000", consumed: "0" },
  },
  reservationId: `0x${"0a".repeat(32)}`,
  at: 1_788_739_220,
  prevReceiptHash: zeroHash,
};

describe("receiptHash", () => {
  it("hashes the canonical form, independent of key order", () => {
    const { receiptId, ...withoutId } = decision;
    const a = receiptHash({ receiptId, ...withoutId });
    const b = receiptHash({ ...withoutId, receiptId });
    expect(a).toBe(b);
    expect(a).toBe(hashCanonicalJson(decision));
  });
});

describe("buildEnvelope", () => {
  it("builds a schema-valid envelope and omits x when no transaction ID is given", () => {
    const envelope = buildEnvelope({
      type: "DECISION",
      correlationId: "00000000-0000-4000-8000-000000000001",
      receiptHash: `0x${"02".repeat(32)}`,
      previousReceiptHash: zeroHash,
      mandateId,
    });
    expect(envelope).toMatchObject({ v: 1, t: "DECISION", h: `0x${"02".repeat(32)}`, p: zeroHash, m: mandateId });
    expect(envelope.x).toBeUndefined();
  });

  it("includes the settlement transaction ID when payment settles", () => {
    const envelope = buildEnvelope({
      type: "PAYMENT",
      correlationId: "00000000-0000-4000-8000-000000000001",
      receiptHash: `0x${"03".repeat(32)}`,
      previousReceiptHash: `0x${"02".repeat(32)}`,
      mandateId,
      transactionId: "0.0.789@1700000000.000000001",
    });
    expect(envelope.x).toEqual({ tx: "0.0.789@1700000000.000000001" });
  });
});

describe("assertTraceLink", () => {
  it("accepts an envelope that links to its predecessor", () => {
    const previous = `0x${"02".repeat(32)}` as const;
    const envelope = buildEnvelope({
      type: "USAGE",
      correlationId: "00000000-0000-4000-8000-000000000001",
      receiptHash: `0x${"03".repeat(32)}`,
      previousReceiptHash: previous,
      mandateId,
    });
    expect(() => assertTraceLink(envelope, previous)).not.toThrow();
  });

  it("rejects a hash-chain break", () => {
    const envelope = buildEnvelope({
      type: "USAGE",
      correlationId: "00000000-0000-4000-8000-000000000001",
      receiptHash: `0x${"03".repeat(32)}`,
      previousReceiptHash: `0x${"02".repeat(32)}`,
      mandateId,
    });
    expect(() => assertTraceLink(envelope, `0x${"99".repeat(32)}`)).toThrow("does not link");
  });
});
