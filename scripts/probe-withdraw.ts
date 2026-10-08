// Phase 4 probe: which destination encodings does Unit accept for a Zcash withdrawal address?
// Generation only: nothing is sent. Destinations are derived from the same key so they are comparable.
import { base58check as b58c } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { parseZcashAddress } from "../src/lib/zcash/address";
const b58 = b58c(sha256);
const seed = parseZcashAddress("tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy"); // key used only for probing encodings
const t1 = b58.encode(Uint8Array.from([0x1c, 0xb8, ...seed.pkh!]));
const tm = "tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy";
const tex = "textest1thdh90ttywp4tjf9ljc7q5u8sa564ggp9jt7yf";
for (const [net, base] of [["testnet", "https://api.hyperunit-testnet.xyz"], ["mainnet", "https://api.hyperunit.xyz"]] as const) {
  for (const [label, dst] of [["tm", tm], ["textest", tex], ["t1", t1]] as const) {
    const r = await fetch(`${base}/gen/hyperliquid/zcash/zec/${dst}`);
    const body = await r.text();
    console.log(net.padEnd(8), label.padEnd(8), r.status, body.slice(0, 260));
  }
}
