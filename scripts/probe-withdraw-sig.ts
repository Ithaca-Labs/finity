// Phase 4 probe: find the payload Unit's guardians sign for a withdrawal (HL protocol address) response.
// Read-only: generation of a protocol address sends nothing. The t1 destination is probe-only and never funded.
import { base58check as b58c } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { GUARDIAN_KEYS } from "../src/lib/bridge/guardians";
import { parseZcashAddress } from "../src/lib/zcash/address";

const b58 = b58c(sha256);
const seed = parseZcashAddress("tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy");
const dst = b58.encode(Uint8Array.from([0x1c, 0xb8, ...seed.pkh!]));
const res = await (await fetch(`https://api.hyperunit.xyz/gen/hyperliquid/zcash/zec/${dst}`)).json();
console.log("protocol address:", res.address, "nodes:", Object.keys(res.signatures));

const hex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));
const enc = new TextEncoder();
const A = [res.address, res.address.toLowerCase()];
const assets = ["zec", "ZEC", "zcash"];
const suffix = ["deposit", "withdraw", "withdrawal", ""];

const cands = (n: string) => {
  const out = new Set<string>();
  for (const a of A) {
    // legacy shape, every ordering of the two chains, with and without a trailing word
    for (const [dc, sc] of [["zcash", "hyperliquid"], ["hyperliquid", "zcash"]]) for (const as of assets) for (const sf of suffix) {
      out.add(`${n}:${[dst, dc, as, a, sc, ...(sf ? [sf] : [])].join("-")}`);
      out.add(`${n}:${[a, dc, as, dst, sc, ...(sf ? [sf] : [])].join("-")}`);
    }
    // "user" shape
    for (const ct of ["zcash", "hyperliquid", "ethereum", "zec"]) for (const dc of ["hyperliquid", "zcash"]) {
      out.add(`${n}:${["user", ct, dc, dst, a].join("-")}`);
      out.add(`${n}:${["user", ct, dc, a, dst].join("-")}`);
    }
  }
  return [...out];
};

let hits = 0, tried = 0;
for (const node of GUARDIAN_KEYS.mainnet) {
  const sig = res.signatures[node.nodeId];
  if (!sig) continue;
  const key = await crypto.subtle.importKey("raw", hex(node.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const s = new Uint8Array(Array.from(atob(sig), (c) => c.charCodeAt(0)));
  for (const m of cands(node.nodeId)) {
    tried++;
    if (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, s, enc.encode(m))) { console.log("MATCH", m); hits++; }
  }
}
console.log("tried", tried, "matches:", hits);
