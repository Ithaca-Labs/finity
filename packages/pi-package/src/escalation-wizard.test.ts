import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256 } from "viem";
import type { CompiledAmendment } from "@finity/mandate-compiler";
import type { SignedAgentMandate } from "@finity/schemas";
import { approveEscalation } from "./escalation-wizard.js";

const mandateId = `0x${"01".repeat(32)}` as const;
const verifyingContract = "0x2222222222222222222222222222222222222222" as const;
const predecessorMandate: SignedAgentMandate = {
  agent: "did:aid:buyer", broker: "0x1111111111111111111111111111111111111111", spendAccount: "0.0.123",
  allowedServices: "hello-weather@1", allowedMethods: "weather.current", asset: "HBAR",
  maxPerRequest: "5000000", maxPerRequestText: "0.05 HBAR", maxPerPeriod: "500000000", maxPerPeriodText: "5.00 HBAR per 24h",
  periodSeconds: "86400", maxLifetime: "2000000000", maxLifetimeText: "20.00 HBAR total", maxUnitsPerRequest: "0",
  validFrom: 1_788_739_200, validUntil: 1_790_208_000, validUntilText: "until 2026-09-24",
  quoteMaxAgeSeconds: "120", dataClass: 0, escalationRule: "anything above per-request cap needs my Ledger",
  policyHash: `0x${"aa".repeat(32)}`, nonce: "1", predecessor: `0x${"00".repeat(32)}`,
  signature: `0x${"bb".repeat(65)}`, mandateId,
};
const proposedAmendment = {
  field: 0, newValue: "6000000", newValueText: "0.06 HBAR", scopeServiceId: "hello-weather@1",
  oneTime: true, validUntil: 1_790_000_000, nonce: predecessorMandate.nonce,
};

describe("approveEscalation", () => {
  it("signs a fresh nonce, not the proposedAmendment's echoed mandate-registration nonce", async () => {
    let seenNonce: bigint | undefined;
    await approveEscalation({
      mandateId, predecessorMandate, proposedAmendment, verifyingContract,
      sign: async (typedData) => {
        seenNonce = typedData.message.nonce;
        return `0x${"cc".repeat(65)}`;
      },
      registryClient: { amend: async () => `0x${"dd".repeat(32)}` },
    });
    expect(seenNonce).toBeDefined();
    expect(seenNonce).not.toBe(BigInt(proposedAmendment.nonce));
  });

  it("computes the successor ID the same way MandateRegistry.sol does: keccak256(abi.encode(mandateId, amendmentDigest))", async () => {
    let capturedTypedData: CompiledAmendment["typedData"] | undefined;
    const result = await approveEscalation({
      mandateId, predecessorMandate, proposedAmendment, verifyingContract,
      sign: async (typedData) => {
        capturedTypedData = typedData;
        return `0x${"cc".repeat(65)}`;
      },
      registryClient: { amend: async () => `0x${"dd".repeat(32)}` },
    });
    expect(capturedTypedData).toBeDefined();
    const { hashTypedData } = await import("viem");
    const digest = hashTypedData(capturedTypedData!);
    const expected = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [mandateId, digest]));
    expect(result.successorMandateId).toBe(expected);
    expect(result.successorMandate.mandateId).toBe(expected);
  });

  it("derives the successor mandate from the predecessor with only the amended fields changed", async () => {
    const result = await approveEscalation({
      mandateId, predecessorMandate, proposedAmendment, verifyingContract,
      sign: async () => `0x${"cc".repeat(65)}`,
      registryClient: { amend: async () => `0x${"dd".repeat(32)}` },
    });
    expect(result.successorMandate).toMatchObject({
      agent: predecessorMandate.agent,
      allowedServices: predecessorMandate.allowedServices,
      maxPerRequest: "6000000",
      maxPerRequestText: "0.06 HBAR",
      validUntil: 1_790_000_000,
      predecessor: mandateId,
    });
    expect(result.successorMandate.mandateId).not.toBe(mandateId);
  });

  it("calls registryClient.amend with the signed amendment", async () => {
    let seenSignature: string | undefined;
    let seenAmendment: { mandateId: string } | undefined;
    await approveEscalation({
      mandateId, predecessorMandate, proposedAmendment, verifyingContract,
      sign: async () => `0x${"cc".repeat(65)}`,
      registryClient: {
        amend: async (amendment, signature) => {
          seenAmendment = amendment;
          seenSignature = signature;
          return `0x${"dd".repeat(32)}`;
        },
      },
    });
    expect(seenSignature).toBe(`0x${"cc".repeat(65)}`);
    expect(seenAmendment?.mandateId).toBe(mandateId);
  });
});
