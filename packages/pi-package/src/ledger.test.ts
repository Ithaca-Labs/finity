import { describe, expect, it } from "vitest";
import type { Signature } from "@ledgerhq/device-signer-kit-ethereum";
import { compile } from "@finity/mandate-compiler";
import { privateKeyToAccount } from "viem/accounts";
import { LedgerSigningError, assembleSignature, verifyTypedDataSignature } from "./ledger.js";

const r = `0x${"11".repeat(32)}` as `0x${string}`;
const s = `0x${"22".repeat(32)}` as `0x${string}`;

describe("assembleSignature", () => {
  it("concatenates r, s, and v into a 65-byte signature", () => {
    const signature: Signature = { r, s, v: 27 };
    expect(assembleSignature(signature)).toBe(`0x${"11".repeat(32)}${"22".repeat(32)}1b`);
  });

  it("normalizes a v below 27 the same way MandateRegistry.sol does", () => {
    const signature: Signature = { r, s, v: 0 };
    expect(assembleSignature(signature)).toBe(`0x${"11".repeat(32)}${"22".repeat(32)}1b`);
    const signatureOne: Signature = { r, s, v: 1 };
    expect(assembleSignature(signatureOne)).toBe(`0x${"11".repeat(32)}${"22".repeat(32)}1c`);
  });

  it("rejects a malformed r or s component", () => {
    expect(() => assembleSignature({ r: "0x1234", s, v: 27 })).toThrow(LedgerSigningError);
  });
});

describe("verifyTypedDataSignature", () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const compiled = compile({
    agent: "did:aid:hedera:testnet:0.0.1:buyer",
    broker: `0x${"22".repeat(20)}`,
    spendAccount: "0.0.2",
    allowedServices: "weather",
    allowedMethods: "current",
    asset: "HBAR",
    maxPerRequest: "5000000",
    maxPerPeriod: "5000000",
    periodSeconds: "86400",
    maxLifetime: "5000000",
    maxUnitsPerRequest: "1",
    validFrom: 1,
    validUntil: 2,
    quoteMaxAgeSeconds: "60",
    dataClass: 0,
    escalationRule: "none",
    policyHash: `0x${"33".repeat(32)}`,
    nonce: "1",
    predecessor: `0x${"00".repeat(32)}`,
    verifyingContract: `0x${"44".repeat(20)}`,
  });
  const typedData = { ...compiled.typedData, types: { AgentMandate: [...compiled.typedData.types.AgentMandate] } };

  it("accepts a signature recovered to the Ledger address", async () => {
    const signature = await account.signTypedData(typedData);
    await expect(verifyTypedDataSignature({ typedData, signature, expectedAddress: account.address })).resolves.toBeUndefined();
  });

  it("rejects a signature recovered to another address", async () => {
    const signature = await account.signTypedData(typedData);
    await expect(verifyTypedDataSignature({
      typedData,
      signature,
      expectedAddress: `0x${"55".repeat(20)}`,
    })).rejects.toMatchObject({ code: "SIGN_FAILED" });
  });
});
