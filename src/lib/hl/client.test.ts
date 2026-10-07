import { describe, expect, it } from "vitest";
import { formatPerpPrice, formatSize, newCloid } from "./client";

describe("hl formatting", () => {
  it("limits price to 5 significant figures", () => {
    expect(formatPerpPrice(123456.789, 5)).toBe("123460");
    expect(formatPerpPrice(1.234567, 2)).toBe("1.2346");
  });
  it("respects max decimals 6 - szDecimals", () => {
    expect(formatPerpPrice(0.0123456, 0)).toBe("0.012346");
    expect(formatPerpPrice(0.0123456, 4)).toBe("0.01");
  });
  it("floors size to szDecimals, never rounds up", () => {
    expect(formatSize(0.00019999, 4)).toBe("0.0001");
    expect(formatSize(1.99999, 2)).toBe("1.99");
  });
  it("makes 16-byte cloids", () => {
    expect(newCloid()).toMatch(/^0x[0-9a-f]{32}$/);
    expect(newCloid()).not.toBe(newCloid());
  });
});
