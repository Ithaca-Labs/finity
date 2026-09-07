import { describe, expect, it } from "vitest";
import type { Signature } from "@ledgerhq/device-signer-kit-ethereum";
import { LedgerSigningError, assembleSignature } from "./ledger.js";

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
