# Runbook: failures and recovery (testnet prototype, 8 Oct 2026)

Every balance is in one of four places. `/return` shows this table ("Where every balance is"); `tsx recovery/recover.ts <net> <address>` prints the same raw data with no app server.

| Bucket | Meaning | What to do |
|---|---|---|
| user_control | On Hyperliquid under the trading key, or delivered to your Zcash wallet | Nothing. Recovery client can read, cancel and reduce-only close (`--exit`) |
| bridge_operation | Inside a recorded Unit operation | Wait. Do not send again. Follow it at `https://api.hyperunit[-testnet].xyz/operations/<hl-address>` |
| residual | Below a route minimum (0.07 ZEC Unit, 10 USDC HL order) | Stays under your key. Top up and return the total, or leave it. Not lost |
| manual_recovery | Unit reports a failure or an unrecognised state, or a deposit below the minimum | Keep the record (`localStorage` keys `funding:v1:*`, `return:v1:*`, `orders:*`) and the Unit operation ID; contact Unit |
| unaccounted | An order or return send whose outcome is unknown | Reconcile (button on `/trade` or `/return`). Never resend first |

## Failure at each money transition

| Transition | Failure | Behaviour | Evidence |
|---|---|---|---|
| Deposit address shown | Unit unreachable / tampered response | No QR; guardian check needs 2 of 3 pinned keys | unit tests |
| Deposit sent | Unit polling fails | State kept, payment request hidden, "do not send again" | unit tests (`provider_error`, `flaky` replay) |
| Deposit sent | Below 0.07 ZEC | `below_minimum_stuck`; QR is blocked below the floor in the first place | unit tests |
| Conversion / perp order | Timeout or tab closed after signing | Journaled `pending` before sending; blocks new-risk orders until reconciled by cloid; reduce-only never blocked | unit tests + tx (Phase 3) |
| Return route | Destination is TEX, shielded, P2SH, or wrong network | Refused before calling Unit | unit tests |
| Return route | Unit signatures < 2 valid or for another destination | Refused | unit tests (live captures) |
| Return send | Timeout or tab closed after signing | `pending` persisted before signing → reloads as `outcome_unknown`; no second send; reconciled from the HL ledger by nonce; "not landed" only after 10 minutes | unit tests |
| Return send | HL rejects | `recoverable_error`; nothing left the account; may send again | unit tests |
| Return in Unit | Unit unreachable | `bridge_return_pending`, marked stale; operations never dropped by a later empty poll | unit tests |
| Return in Unit | Unit `failure` | `manual_recovery` | unit tests |
| Delivered | Transparent payout | "Delivered to your Zcash wallet — open the wallet and shield." Shielding can only be *user marked*; there is no wallet integration, so `wallet_confirmed_shielded` is never set by this app | unit tests |
| Any | Local storage cleared | HL and Unit remain the source of truth. Before any return send, the HL ledger (last 2 days) is checked for sends to that Unit address; one the browser has no record of blocks the send | unit test + browser |

## Known limits
- No USDC withdrawal route from HL is tested; it is not offered.
- A user-signed `spotSend` has no expiry. After 10 minutes with no ledger entry we allow a new send; if the old one surfaced later, both would go to the same verified Unit route (same destination wallet), not to a third party.
- Browser-checked 9 Oct (`scripts/e2e-browser.mjs`, 21/21): Unit + HL CORS from the page, reload, two tabs, cleared storage, Unit down, HL down. Read-only: no send was signed in the browser.
