// Re-test of the Phase 4 finding: does Unit testnet generate a withdrawal address for a FRESH tm destination?
// Earlier probes used Unit's own deposit address as the destination, which may be what was rejected.
import { base58check as b58c } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
const b58 = b58c(sha256);
const fresh = b58.encode(Uint8Array.from([0x1d, 0x25, ...crypto.getRandomValues(new Uint8Array(20))])); // random tm…, never funded
const unitOwn = "tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy";
for (const [label, dst] of [["fresh tm", fresh], ["Unit's own deposit address", unitOwn]] as const) {
  const r = await fetch(`https://api.hyperunit-testnet.xyz/gen/hyperliquid/zcash/zec/${dst}`);
  console.log(label.padEnd(28), dst, "->", r.status, (await r.text()).slice(0, 110).replace(/\n/g, ""));
}
