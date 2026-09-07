import { describe, expect, it } from "vitest";
import { compileAmendment, compileRevocation } from "./revocation-amendment.js";

const verifyingContract = "0x2222222222222222222222222222222222222222" as const;
const mandateId = `0x${"01".repeat(32)}` as const;

describe("compileRevocation", () => {
  const base = { mandateId, nonce: "40", reason: "principal emergency stop", verifyingContract };

  it("is deterministic and matches the field order MandateRegistry.sol's REVOCATION_TYPEHASH expects", () => {
    const a = compileRevocation(base);
    const b = compileRevocation({ ...base });
    expect(a.digest).toBe(b.digest);
    expect(a.typedData.types.Revocation.map((field) => field.name)).toEqual(["mandateId", "nonce", "reason"]);
    expect(a.typedData.domain).toEqual({ name: "FinityMandate", version: "1", chainId: 296, verifyingContract });
  });

  it("changes the digest when the reason changes", () => {
    const a = compileRevocation(base);
    const b = compileRevocation({ ...base, reason: "different reason" });
    expect(a.digest).not.toBe(b.digest);
  });

  it("rejects a malformed mandateId", () => {
    expect(() => compileRevocation({ ...base, mandateId: "not-a-hash" as never })).toThrow();
  });
});

describe("compileAmendment", () => {
  const base = {
    mandateId, field: 0, newValue: "100000000", newValueText: "1.00 HBAR",
    scopeServiceId: "hello-weather@1", oneTime: true, validUntil: 1_790_000_000, nonce: "50",
    verifyingContract,
  };

  it("is deterministic and matches the field order MandateRegistry.sol's AMENDMENT_TYPEHASH expects", () => {
    const a = compileAmendment(base);
    const b = compileAmendment({ ...base });
    expect(a.digest).toBe(b.digest);
    expect(a.typedData.types.MandateAmendment.map((field) => field.name)).toEqual([
      "mandateId", "field", "newValue", "newValueText", "scopeServiceId", "oneTime", "validUntil", "nonce",
    ]);
  });

  it("changes the digest when newValue changes", () => {
    const a = compileAmendment(base);
    const b = compileAmendment({ ...base, newValue: "200000000" });
    expect(a.digest).not.toBe(b.digest);
  });
});
