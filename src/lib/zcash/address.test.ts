import { describe, expect, it } from "vitest";
import { buildZip321, formatZecAmount, parseZcashAddress, sameTransparentKey, texToP2pkh, zecToZatoshis } from "./address";

// Live Unit testnet pair for our account, 7 Oct 2026: /gen returned tm…, /operations listed textest1….
const TM = "tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy";
const TEXTEST = "textest1thdh90ttywp4tjf9ljc7q5u8sa564ggp9jt7yf";

describe("zcash address parsing", () => {
  it("parses testnet P2PKH and TEX", () => {
    expect(parseZcashAddress(TM)).toMatchObject({ network: "testnet", kind: "p2pkh" });
    expect(parseZcashAddress(TEXTEST)).toMatchObject({ network: "testnet", kind: "tex" });
  });
  it("live tm… and textest1… mapping are the same key", () => {
    const tex = parseZcashAddress(TEXTEST);
    expect(texToP2pkh(tex)).toBe(TM);
    expect(sameTransparentKey(tex, parseZcashAddress(TM))).toBe(true);
  });
  it("rejects a bad checksum", () => {
    expect(() => parseZcashAddress(TM.slice(0, -1) + (TM.endsWith("y") ? "z" : "y"))).toThrow();
    expect(() => parseZcashAddress(TEXTEST.slice(0, -1) + "q")).toThrow();
  });
  it("rejects whitespace and junk", () => {
    expect(() => parseZcashAddress(` ${TM}`)).toThrow();
    expect(() => parseZcashAddress("0x1f20B96A9fde5218ED05A212B2d23093100785c0")).toThrow();
  });
});

describe("ZIP-321", () => {
  it("builds a URI with exact decimal amount", () => {
    expect(buildZip321(TEXTEST, "testnet", zecToZatoshis("0.1"))).toBe(`zcash:${TEXTEST}?amount=0.1`);
  });
  it("rejects an address for the wrong network", () => {
    expect(() => buildZip321(TEXTEST, "mainnet", 10_000_000n)).toThrow(/testnet/);
    expect(() => buildZip321(TM, "mainnet", 10_000_000n)).toThrow();
  });
  it("formats and parses zatoshis without float error", () => {
    expect(formatZecAmount(7_581_428n)).toBe("0.07581428");
    expect(formatZecAmount(100_000_000n)).toBe("1");
    expect(zecToZatoshis("0.07581428")).toBe(7_581_428n);
    expect(() => zecToZatoshis("0.123456789")).toThrow();
    expect(() => zecToZatoshis("1e-3")).toThrow();
  });
});
