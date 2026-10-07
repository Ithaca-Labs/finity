// Zcash address parsing (network + type), TEX <-> P2PKH equivalence, and ZIP-321 URIs.
// The site never holds Zcash spending keys; this only reads and formats addresses.
import { base58check as b58c, bech32, bech32m } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Network } from "../bridge/guardians";

const base58check = b58c(sha256);

export type ZcashAddressKind = "p2pkh" | "p2sh" | "tex" | "sapling" | "unified";
export interface ZcashAddress {
  raw: string;
  network: Network;
  kind: ZcashAddressKind;
  /** 20-byte pubkey hash for p2pkh and tex (the shared identity behind both encodings). */
  pkh?: Uint8Array;
}

// Transparent base58check version prefixes (Zcash protocol spec §5.6.1.1).
const T_PREFIX: { bytes: [number, number]; network: Network; kind: "p2pkh" | "p2sh" }[] = [
  { bytes: [0x1c, 0xb8], network: "mainnet", kind: "p2pkh" }, // t1
  { bytes: [0x1c, 0xbd], network: "mainnet", kind: "p2sh" }, // t3
  { bytes: [0x1d, 0x25], network: "testnet", kind: "p2pkh" }, // tm
  { bytes: [0x1c, 0xba], network: "testnet", kind: "p2sh" }, // t2
];
// ZIP 320 TEX, ZIP 316 unified, Sapling HRPs.
const HRP: Record<string, { network: Network; kind: ZcashAddressKind }> = {
  tex: { network: "mainnet", kind: "tex" },
  textest: { network: "testnet", kind: "tex" },
  u: { network: "mainnet", kind: "unified" },
  utest: { network: "testnet", kind: "unified" },
  zs: { network: "mainnet", kind: "sapling" },
  ztestsapling: { network: "testnet", kind: "sapling" },
};

/** Throws on anything that is not a well-formed Zcash address. */
export function parseZcashAddress(raw: string): ZcashAddress {
  const s = raw.trim();
  if (s !== raw || !s) throw new Error("Address has surrounding whitespace or is empty");
  if (/^t[123m]/.test(s)) {
    const bytes = base58check.decode(s); // verifies checksum
    const p = T_PREFIX.find((x) => bytes[0] === x.bytes[0] && bytes[1] === x.bytes[1]);
    if (!p || bytes.length !== 22) throw new Error("Unknown transparent address prefix");
    return { raw: s, network: p.network, kind: p.kind, pkh: p.kind === "p2pkh" ? bytes.slice(2) : undefined };
  }
  const hrp = s.slice(0, s.lastIndexOf("1"));
  const info = HRP[hrp];
  if (!info) throw new Error("Unrecognised Zcash address");
  if (info.kind === "sapling") {
    bech32.decode(s as `${string}1${string}`, 200);
    return { raw: s, ...info };
  }
  const { words } = bech32m.decode(s as `${string}1${string}`, 2000); // verifies checksum
  if (info.kind === "tex") {
    const pkh = bech32m.fromWords(words);
    if (pkh.length !== 20) throw new Error("TEX payload must be 20 bytes");
    return { raw: s, ...info, pkh: Uint8Array.from(pkh) };
  }
  return { raw: s, ...info };
}

export function texToP2pkh(tex: ZcashAddress): string {
  if (tex.kind !== "tex" || !tex.pkh) throw new Error("Not a TEX address");
  const prefix = T_PREFIX.find((p) => p.network === tex.network && p.kind === "p2pkh")!.bytes;
  return base58check.encode(Uint8Array.from([...prefix, ...tex.pkh]));
}

/** True when two addresses are the same transparent key on the same network (e.g. tm… and textest1…). */
export function sameTransparentKey(a: ZcashAddress, b: ZcashAddress): boolean {
  if (a.network !== b.network || !a.pkh || !b.pkh) return false;
  return a.pkh.length === b.pkh.length && a.pkh.every((x, i) => x === b.pkh![i]);
}

/** ZIP-321 amounts: decimal ZEC, at most 8 decimals, no exponent. */
export function formatZecAmount(zatoshis: bigint): string {
  if (zatoshis <= 0n) throw new Error("Amount must be positive");
  const whole = zatoshis / 100_000_000n;
  const frac = (zatoshis % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function zecToZatoshis(zec: string): bigint {
  if (!/^\d+(\.\d{1,8})?$/.test(zec)) throw new Error("Amount must be a decimal with at most 8 decimals");
  const [w, f = ""] = zec.split(".");
  return BigInt(w) * 100_000_000n + BigInt(f.padEnd(8, "0"));
}

/**
 * ZIP-321 payment URI. Rejects an address for the wrong network. No memo: memos are
 * not allowed for transparent or TEX recipients.
 */
export function buildZip321(address: string, expected: Network, zatoshis: bigint): string {
  const a = parseZcashAddress(address);
  if (a.network !== expected) throw new Error(`Address is for ${a.network}, expected ${expected}`);
  return `zcash:${a.raw}?amount=${formatZecAmount(zatoshis)}`;
}
