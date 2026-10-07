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
