# Test evidence: HL testnet (7 Oct 2026)

Account: `0x1f20B96A9fde5218ED05A212B2d23093100785c0` (throwaway, testnet-only key in gitignored `.env.local`).
Funding: 500 mock USDC sent from a team wallet's faucet claim, arriving in spot. **Test-only funding, not part of the privacy route.**

Run: `npm run phase1` (script `scripts/phase1.ts`)

| Step | Result |
|---|---|
| Start | spot 500 USDC, perps 0 |
| `usdClassTransfer` 400 toPerp | ok; perps 400, spot 100 |
| BTC IOC buy, ~$24 notional, 5% price bound | filled 0.00029 @ 83463.0, cloid `0x03288e49db719d5751b3728450b8c405`, oid 62074833845, fee 0.010891 |
| Reduce-only IOC close | filled 0.00029 @ 83462.0, cloid `0xc152602d2040bf2cf6795e74217ea594`, oid 62074835984, fee 0.010891 |
| End | perps 399.977928 (loss 0.0221 = 2 fees + 1 USDC tick of spread), spot 100, no positions |

Every balance is accounted for: spot 100 + perps 399.977928 = 499.977928 of 500.

Recovery CLI (`recovery/recover.ts`) read-only run with no app server: balances and open orders read correctly.
Not yet tested: `--exit` against a live position, second-machine restore, builder-fee approval.

## Phase 1b: recovery exit and builder fee (7 Oct 2026, `npm run` via `scripts/phase1b.ts`)

| Step | Result |
|---|---|
| Open BTC long 0.00029 | filled, cloid `0xa1e8d11ab1aef080fd97296a945c16f3` |
| `recovery/recover.ts --exit` in a separate process, key via env only | closed the position reduce-only; positions after = 0 |
| `approveBuilderFee` (builder = own account, 0.05%), signed by the account's own key | ok |
| Open with `builder: {b, f: 50}` | filled, cloid `0x7a47d680d13ec5abe12d1fc54e958530`, **builderFee 0.012101** on ~$24.2 notional (0.05%) |
| Close | filled, cloid `0x31bfb67b5e884613ba701c33221561f6` |

Caveat: builder = the trader's own account, so this proves attribution mechanics only, not revenue.

## Phase 3: conversion, builder, unknown-outcome reconciliation (7 Oct 2026, `npm run phase3`)

Account `0x1f20…85c0`, mode `default` (spot USDC is not perps margin, so `usdClassTransfer` is required).

| Step | Result |
|---|---|
| Resolve official XZEC by token ID | token 1526, `@1401`, order asset 11401, spotSend selector `XZEC:0xc8e8…759d`, szDecimals 4 |
| Plan XZEC → USDC 0.1 | **refused: no bids.** Real XZEC conversion is not demonstrated on testnet |
| Substitute pair PURR/USDC (resolved by token ID `0xc4bf…96c2`), **not evidence for XZEC** | |
| Buy 2 PURR (~9.25 USDC) | rejected by HL: "Order must have minimum value of 10 USDC". The planner now refuses below 10 USDC before signing |
| Buy 3 PURR | filled 3.0 @ 4.6252, cloid `0x139058dd10365c0f16a194f09df1cd31`; **received 2.9979** (fee taken in base token) |
| Sell back | refused by planner: 2.9979 floors to 2 PURR (szDecimals 0) = 9.16 USDC < 10 minimum |
| Buy 3 more, then sell 5 | buy cloid `0x698f0a58650c55c63429f2a60462435c`; sell filled 5.0 @ 4.5795, cloid `0x43c77e8ed8aecae1ac6878ce3702dba4` |
| Residual | 0.9958 PURR dust (below size step/minimum), recorded, not lost |
| Builder status (self as builder) | approved, maxBuilderFee 50 |
| BTC open with response **dropped after HL received it** (injected) | journaled `unknown`, cloid `0x18a91816d3a42ad8419b4ba2bd15bcb8` |
| Second order on the account | **blocked** (`OrderBlockedError`), nothing sent |
| Reconcile by cloid | `filled` 0.00015 @ 83305, evidence `reconciled_order_status`; builderFee 0.006247 in fills |
| Reduce-only close | filled 0.00015 @ 83324, cloid `0xcf52f29edfef0f75c7635342014e34a0` |
| End | perps 399.894328, 0 positions; spot USDC 95.13027175 + PURR 0.9958 |

**Bug found and fixed in the first run** (cloid `0x38f32c7ec90bb145578a064fbb3da818`): reconciling ~1.5 s after submission returned `unknownOid` and no fills for an order that HAD filled, and the code marked it `not_landed`, which would have allowed a duplicate. Seconds later the same query showed it filled. Fix: every order is now signed with `expiresAfter` (20 s), and `unknownOid` stays `unknown` (blocking) until that deadline + 15 s has passed.

## Phase 4: return leg and recovery under failure (8 Oct 2026)

Run: `npx tsx scripts/phase4.ts` (and `scripts/phase4-withdraw.ts`, `scripts/account-balances.ts`).

### A. Unit withdrawal address generation
| Network | Destination encodings tried | Result |
|---|---|---|
| testnet | `tm…`, `textest1…`, `t1…`, all derived from **Unit's own deposit address** | HTTP 400 `address failed verification`. **CORRECTED 11 Oct:** this was a flaw in my probe, not a Unit limitation. A protocol address cannot be a destination. A fresh random `tm…` destination returns 200 with a protocol address (`scripts/probe-withdraw-fresh.ts`). |
| mainnet | `tm…`, `textest1…` | HTTP 400 (wrong network) |
| mainnet | `t1…` (probe-only address, never funded) | HTTP 200, protocol address `0x4E6091f91c8174466337E09F79b37056B150c3a1`, **3 of 3 guardians verify** |

Guardian payload for a withdrawal: `nodeId:user-ethereum-zcash-<zcash destination>-<hl protocol address>` (`coinType = "ethereum"`),
found by search; not stated in Unit's docs. Nothing was sent to the protocol address.

### B. Transfer journal against real Hyperliquid testnet
| Step | Result |
|---|---|
| Journal, then real `spotSend` of 1 USDC to a second throwaway testnet account; response deliberately discarded | state `unknown`, signed nonce `1791447174436`, account blocked |
| Second send attempted | refused (`TransferBlockedError`) |
| All local storage wiped; journal entry re-imported | state restored from the exported nonsecret record |
| `reconcileTransfer` against `userNonFundingLedgerUpdates` | **found by nonce**: state `sent`, evidence `reconciled_ledger`, hash `0x6cb7207d8170603c6e30042b30065b0000f238631c737f0e107fcbd040743a27` |
| Funds moved exactly once | sender spot 95.13027175 -> 93.13027175 (1 amount + **1.0 USDC fee**), receiver 0 -> 1 |

Fee finding: Hyperliquid charged the **sender** 1.0 USDC to send to a new account. The ledger entry that funded the trading
account shows the same: 500.0 delivered, `fee: 1.0` paid by the team wallet. **Activation payer = sender**, closing the open item.

### C. Alternate USDC route (HL bridge withdrawal)
`withdraw3` to the account's own address returned `Error withdrawing from bridge` at 5, 10 and 50 USDC; nothing appeared in the
ledger and `withdrawable` was unchanged. **Attempt failed**; the route is labelled `attempt_failed` and is not advertised.

### D. Account reconciliation (`scripts/account-balances.ts`)
Trading account: received 500 (sender paid a 1.0 fee), sent 1 (+1.0 fee), perp PnL 0.00676, perp fees 0.112432, spot USDC flow -4.8537,
spot fee 0.016028. Expected 493.024600, actual spot 93.13027175 + perps 399.894328 = 493.024600. **USDC unexplained: 0.000000**
(the self-builder fee of 0.024595 is paid to the same account, so it nets to zero). Receiver holds 1.0 USDC.
**Not accounted for:** the Phase 3 PURR test trades imply about 0.9958 PURR (~4.6 testnet USDC) still held, but the spot balance
shows no PURR. Cause not found. It is test money, but the gate "every balance accounted" is therefore not fully met for PURR.

### E. Automated failure injection (`npm test`, `src/lib/bridge/withdraw.test.ts`)
Journal-before-send; timeout leaves `unknown` and blocks a second send; exchange rejection is final and does not block; two
concurrent clicks send once; fresh increasing nonces; self-send refused; reconcile after storage wipe; ledger entries with a
different nonce/destination/sender are ignored; provider 503 leaves the record unknown and blocking; override only after the
settling period and recorded; broken or missing storage does not crash reads; tampered protocol address, destination or fewer than
2 guardian signatures rejected; shielded/unified/TEX/wrong-network destinations refused; below-minimum, over-balance and
fee-eats-amount cases; shielding labels cannot reach "wallet confirmed" without wallet evidence.
