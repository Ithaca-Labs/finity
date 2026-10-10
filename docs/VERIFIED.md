# Evidence ledger (updated 7 Oct 2026)

Levels: **live** = observed from live API; **tx** = transaction demonstrated; **doc** = documented only; **open** = unresolved.

| Claim | Level | Notes |
|---|---|---|
| Unit testnet `/gen/zcash/hyperliquid/zec/<addr>` returns a `tm…` address with 3 guardian signatures | live | `npm run probe:unit`; address for our account: `tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy` |
| Guardian signatures verify against pinned testnet keys (3/3), fail with mainnet keys, fail when address or destination is tampered | live + unit tests | `src/lib/bridge/guardians.test.ts` |
| **Signed payload for Zcash is `nodeId:user-zcash-<destChain>-<destAddr>-<depositAddr>`** (`coinType = "zcash"`) | live | Unit's docs example does not state this; the legacy `...-deposit` payload did NOT verify. Found by variant search. |
| Unit CORS preflight (`OPTIONS`) returns 204 with `access-control-allow-origin: *` | live (curl) | Not yet verified from a real browser page |
| Testnet fee snapshot: deposit 0.00581428 ZEC (eta 126m), withdrawal 0.00015 ZEC (eta 5m) | live | Moves over time |
| Official XZEC (`0xc8e8…9d`) = token 1526, market `@1401`, order book empty | live | `npm run probe:xzec` |
| Lookalikes UZEC (`@1326`) and BZEC (`@1349`) also exist, books empty | live | BZEC is new vs the PRD; match by token ID, never by name |
| Testnet ZEC perp `isDelisted: true`, max leverage 3 | live | Testnet trading uses BTC/ETH |
| HL testnet account: spot USDC arrives as spot; `userAbstraction = default`, so spot→perps transfer is required | live | See TEST_EVIDENCE.md |
| Real testnet BTC open + reduce-only close with cloids | tx | See TEST_EVIDENCE.md |
| Unit testnet withdrawal works | open | Not tested |
| Real Unit testnet deposit settles to XZEC | open | Needs Zcash testnet coins |
| Activation fee payer for the new account | open | Spot balance arrived as exactly 500.0, no visible deduction; payer unconfirmed |
| Zodl testnet / TEX handoff | open | Needs a human with the app |
| Recovery `--exit` closes a live position with no app server | tx | TEST_EVIDENCE.md, Phase 1b |
| `approveBuilderFee` by main key + attributed fill (builderFee field on fill) | tx | Self-as-builder test only |
| Zcash testnet faucet `testnet.zecfaucet.com` | open | Domain does not resolve from this machine; earlier link was unverified. Source a current faucet or Zcash Discord |
| Colosseum FAQ: 2-3 min pitch video, demo <= 3 min, hackathon ends 12 Oct | doc | Exact cutoff/timezone not on the public page; check the portal |
| Unit testnet `/gen` returns `tm…` but `/operations` lists the same mapping as `textest1…`; both decode to the same pubkey hash | live + unit test | Testnet uses TEX too. We pay exactly what `/gen` returns and reject the mapping if `/operations` lists a different key. Open: which encoding Unit expects us to pay on testnet |
| Guardian signatures verify for a TEX address through its P2PKH form | unit test | `src/lib/bridge/unit.test.ts` |
| Testnet XZEC tokenId resolves to token 1526 for balance reads | live | `src/lib/hl/xzec.ts` |
| Unit withdrawal address generation, mainnet `t1…` destination: 200 with a Unit-derived HL address, 3/3 guardians verify | live | payload `user-ethereum-zcash-<dest>-<addr>`; probe address only, nothing sent |
| Unit testnet withdrawal generation for a FRESH `tm…` destination returns 200 + protocol address; it rejects only Unit's own deposit address (400). CORRECTS an earlier row of mine that said every destination was rejected | live | `scripts/probe-withdraw-fresh.ts`, 11 Oct |
| Real testnet XZEC return | open | Blocked by having no XZEC (no settled testnet deposit) and an empty XZEC book, not by address generation |
| Spot send journal: unknown outcome recovered from HL ledger by signed nonce after storage wipe | tx | TEST_EVIDENCE.md Phase 4 B |
| HL charges the SENDER 1.0 USDC when sending to a new account (activation fee payer) | live ledger | closes the activation-payer open item for the testnet funding path |
| HL USDC bridge withdrawal (`withdraw3`) on testnet | attempt failed | "Error withdrawing from bridge" at 5, 10, 50 USDC |
| Unit withdrawal confirmations: 5,000 (lifecycle page) versus 2,000 (overview) | open | Needs a real mainnet withdrawal |
| Account reconciliation: USDC 0.000000 unexplained; ~0.9958 PURR from Phase 3 tests unlocated | live | TEST_EVIDENCE.md Phase 4 D |
