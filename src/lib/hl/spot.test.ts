import { describe, expect, it } from "vitest";
import { availableSpot, formatSpotPrice, quoteIoc, resolveSpotFromMeta } from "./spot";
import { builderForOrder, isBuilderLimitError, needsClassTransfer } from "./account";

// Shape of live spotMeta, with the testnet XZEC and its UZEC lookalike.
const META = {
  tokens: [
    { name: "USDC", index: 0, tokenId: "0x6d1e7cde53ba9467b783cb7c530ce054", szDecimals: 8 },
    { name: "UZEC", index: 1200, tokenId: "0xdeadbeef000000000000000000000000", szDecimals: 2 },
    { name: "XZEC", index: 1526, tokenId: "0xc8e8047efa1400eb0b7b9bbee16b759d", szDecimals: 3 },
  ],
  universe: [
    { name: "@1326", index: 1326, tokens: [1200, 0] },
    { name: "@1401", index: 1401, tokens: [1526, 0] },
  ],
};

describe("spot market resolution", () => {
  it("resolves by token id, not by name, and separates order asset from spotSend selector", () => {
    const m = resolveSpotFromMeta(META, "0xc8e8047efa1400eb0b7b9bbee16b759d");
    expect(m).toMatchObject({ pair: "@1401", asset: 11401, tokenSelector: "XZEC:0xc8e8047efa1400eb0b7b9bbee16b759d" });
    expect(m.base.szDecimals).toBe(3);
  });
  it("rejects an unknown token id", () => {
    expect(() => resolveSpotFromMeta(META, "0x00")).toThrow(/not found/);
  });
});

const book = (bids: [string, string][], asks: [string, string][]) => ({ levels: [bids.map(([px, sz]) => ({ px, sz })), asks.map(([px, sz]) => ({ px, sz }))] as any });

describe("conversion quotes", () => {
  it("refuses an empty book (the testnet XZEC case)", () => {
    expect(quoteIoc(book([], []), false, 1, 0.01, 3)).toMatchObject({ ok: false });
  });
  it("sell walks bids down to the bound and flags expected partial fill", () => {
    const q = quoteIoc(book([["100", "0.5"], ["99.5", "0.3"], ["97", "10"]], [["101", "5"]]), false, 1, 0.01, 2);
    expect(q.ok && q.boundPx).toBe("99");
    expect(q.ok && q.estFillSz).toBeCloseTo(0.8);
    expect(q.ok && q.partialExpected).toBe(true);
  });
  it("buy lifts asks within the bound", () => {
    const q = quoteIoc(book([["99", "1"]], [["101", "2"], ["150", "9"]]), true, 1.5, 0.02, 2);
    expect(q).toMatchObject({ ok: true, estFillSz: 1.5, partialExpected: false });
    expect(q.ok && Number(q.boundPx)).toBeCloseTo(103.02);
  });
  it("spot price: 5 sig figs, max 8 - szDecimals decimals", () => {
    expect(formatSpotPrice(1313.4567, 2)).toBe("1313.5");
    expect(formatSpotPrice(0.000123456, 2)).toBe("0.000123");
    expect(formatSpotPrice(0.000123456, 0)).toBe("0.00012346");
  });
  it("available balance excludes held funds", () => {
    expect(availableSpot([{ token: 1526, total: "1.5", hold: "0.4" }], 1526)).toBeCloseTo(1.1);
    expect(availableSpot([], 1526)).toBe(0);
  });
});

describe("account mode and builder", () => {
  it("only default/disabled modes need a spot->perps transfer", () => {
    expect(needsClassTransfer("default")).toBe(true);
    expect(needsClassTransfer("unifiedAccount")).toBe(false);
    expect(needsClassTransfer("portfolioMargin")).toBe(false);
  });
  it("recognises the 10-approval limit error and never attaches an unapproved builder", () => {
    expect(isBuilderLimitError("Builder fee approval limit reached: max 10")).toBe(true);
    expect(isBuilderLimitError("Insufficient margin")).toBe(false);
    expect(builderForOrder({ kind: "not_approved", builder: "0x1", maxF: 0 })).toBeUndefined();
    expect(builderForOrder({ kind: "unreadable", builder: "0x1", error: "x" })).toBeUndefined();
    expect(builderForOrder({ kind: "approved", builder: "0x1", maxF: 50 })).toEqual({ b: "0x1", f: 50 });
  });
});
