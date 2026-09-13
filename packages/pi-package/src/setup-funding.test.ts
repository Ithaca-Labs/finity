import { describe, expect, it } from "vitest";
import { SETUP_FEE_RESERVE_TINYBAR, fundingAmountFromMandateDraft, validateFundingAmountTinybar } from "./setup-funding.js";

describe("setup funding", () => {
  it("derives lifetime cap plus the fee reserve from a mandate draft", () => {
    expect(SETUP_FEE_RESERVE_TINYBAR).toBe(200_000_000n);
    expect(fundingAmountFromMandateDraft({ maxLifetime: "2000000000" })).toBe("2200000000");
  });

  it("fails closed when the draft has no usable lifetime cap", () => {
    expect(fundingAmountFromMandateDraft(undefined)).toBeUndefined();
    expect(fundingAmountFromMandateDraft({ maxLifetime: "0" })).toBeUndefined();
    expect(fundingAmountFromMandateDraft({ maxLifetime: 2_000_000_000 })).toBeUndefined();
    expect(fundingAmountFromMandateDraft({ maxLifetime: "2.5" })).toBeUndefined();
  });

  it("accepts only positive integer tinybars for the explicit override", () => {
    expect(validateFundingAmountTinybar("1")).toBe("1");
    expect(() => validateFundingAmountTinybar("0")).toThrow();
    expect(() => validateFundingAmountTinybar("1.5")).toThrow();
  });
});
