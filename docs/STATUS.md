# Phase 0 and Phase 1 status (7 Oct 2026)

Labels follow the PRD: **tx** = real testnet transaction, **live** = live API observed, **unit test** = automated test, **not tested** = no evidence.

## Tested

| What | Evidence | How to reproduce |
|---|---|---|
| Unit testnet deposit address generation for our HL account | live | `npm run probe:unit` |
| Guardian verification: pinned per-network keys, 2-of-3 threshold; rejects other network's keys, tampered address, tampered destination, <2 signatures | live + 7 unit tests | `npm test` |
| Real Zcash guardian payload format (`user-zcash-...`) | live | differs from Unit's docs example |
| Unit CORS preflight | live (curl only) | see "Not tested" for browser |
| Official XZEC identity (token 1526, `@1401`), lookalikes UZEC and BZEC, books empty, testnet ZEC perp delisted | live | `npm run probe:xzec` |
| spot to perps transfer (`usdClassTransfer`) | tx | `npm run phase1` |
| BTC IOC open and reduce-only close, with client order IDs | tx | `npm run phase1` |
| Recovery CLI read-only and `--exit` on a live position, no app server | tx | `recovery/recover.ts` |
| `approveBuilderFee` by the account's own key, attributed fill (0.05%) | tx | `scripts/phase1b.ts` (self as builder) |
| Price/size formatting, cloids, journal secret filter | 5 unit tests | `npm test` |
| Balances reconcile: spot 100 + perps 399.97 of 500 | tx | docs/TEST_EVIDENCE.md |

## Not tested, and why

| What | Why |
|---|---|
| Real Unit testnet deposit settling to XZEC | No Zcash testnet coins. The faucet domain I first tried does not resolve, and I found no working one. A testnet wallet build is in progress (native Windows build failed: no MSVC or GCC; retrying in a Linux container). |
| Unit testnet withdrawal | Depends on a settled deposit. Earlier sample requests returned HTTP 400. |
| Conversion XZEC to USDC and back | The XZEC, UZEC and BZEC order books on testnet are empty, so no counterparty exists. |
| Browser-based CORS and status calls | Only curl preflight run. No browser tooling used. |
| Zodl testnet and TEX/ZIP-321 handoff | Needs a person with the app. |
| Sign-to-derive account mode | Not built. Phase 1 uses the dedicated-key fallback the PRD allows. Needs a security review before any mainnet use. |
| Second-machine/browser restore of the account | The account is a plain key in `.env.local`. Not run on a second machine. |
| Faucet activation payer | Spot balance arrived as exactly 500.0, so payer is unconfirmed. |
| Duplicate-click, two-tab and reload safety, partial IOC fills, unknown-outcome reconciliation under real failure | Logic exists (cloid, `reconcileCloid`) but no failure injection yet. |
| UI beyond a landing shell; ZIP-321 and address parsing; replay adapter | Not built yet (Phase 2 and later). |
| Builder revenue | Self-as-builder only proves attribution mechanics. |
| Any mainnet action | None performed, by design. |

## Secrets
The testnet-only private key is in `.env.local`, which is gitignored and not committed.

# Phase 2 status (7 Oct 2026)

| What | Evidence |
|---|---|
| Zcash address parsing (t1/t3/tm/t2, TEX, sapling, unified), checksum, network check; TEX↔P2PKH | 7 unit tests, incl. the live tm/textest pair |
| ZIP-321 URI with wrong-network rejection, exact zatoshi amounts | unit tests |
| Unit adapter: verified address (2-of-3, pinned keys, TEX via P2PKH), mapping cross-check, live fees, 0.07 ZEC + fee floor, 2 ZEC pilot cap | unit tests + live fee read |
| Funding state: dedupe by source tx, ops never dropped, poll errors keep state and hide the payment request, done needs token balance | 8 unit tests |
| Replay adapter (testnet-only, labelled; real captured signatures, synthetic operations) | unit tests |
| `/fund` screen: lane select, recovery + consent gates, QR, polling, persisted record | `next build` passes; **not exercised in a browser** |

Not tested: real deposit (no testnet ZEC), browser CORS from the page, wallet scanning the QR, reload behaviour in a real browser.
Tooling note: the lockfile was missing rolldown's native binding (vitest failed on macOS); `@rolldown/binding-darwin-arm64` is now an optional dep.

## Phase 2 gate: NOT fully passed (7 Oct)

Passed on replay fixtures and unit tests only. Open items:
- [ ] Real Unit testnet deposit followed to XZEC (blocked: no testnet ZEC)
- [ ] `/fund` exercised in a real browser: CORS, reload, provider-error behaviour
- [ ] A real wallet scans the ZIP-321 QR
- [ ] Which encoding Unit expects us to pay on testnet (`tm…` vs `textest1…`)

## Team Zcash testnet wallet

- Tool: zingo-cli 0.1.1 (Rust light wallet), binary at `~/Desktop/tyr/.tools/bin/zingo-cli`; this build skips the mixnet, so the indexer sees our IP (testnet only)
- Data: `.zcash-testnet-wallet/` (gitignored; seed never printed or committed)
- Indexer: `https://testnet.zec.rocks:443` works; `lightwalletd.testnet.electriccoin.co:9067` refused; the built-in server sweep found nothing
- Receive address: `utest10l2ehwun0ruswarh3cufm3lxsyhjwpxepskckhthsetnqz8kpkvc2tyee5d6k4e0qugup7g06qsf8uk35qen97th5fhzr23wcq343y8r`
- Balance: 0 at height 4,475,074. Faucets `faucet.zecpages.com` and `faucet.testnet.z.cash` do not respond; `testnet.zecfaucet.com` does not resolve. Mining with zebrad was declined. Next: request ~0.2 TAZ from the community.

# Phase 3 status (7 Oct 2026)

| What | Evidence |
|---|---|
| Spot conversion module (`src/lib/hl/spot.ts`): token-ID resolution, order asset vs spotSend selector, spot price rule, book-walk quote, 10 USDC minimum, IOC with partial handling | 7 unit tests + **tx** both directions on substitute pair PURR/USDC |
| XZEC ⇄ USDC conversion | **not demonstrated**: testnet XZEC book has no bids; planner refuses honestly |
| Order journal (`src/lib/hl/orders.ts`): cloid journaled before send, signed `expiresAfter`, unknown/pending blocks new orders across reloads and tabs (Web Locks), duplicate-click lock, reduce-only never blocked, persistent per-account nonces | 13 unit tests + **tx** lost-response injection on testnet |
| Reconciliation by cloid (order status + fills) incl. partial and not-landed after deadline | unit tests + **tx** |
| Account mode → spot/perps transfer decision; builder status/approval, 10-approval limit handling, builder never attached to closes or when unapproved | unit tests + tx (approval from Phase 1b; status read live) |
| `/trade` screen: key in memory only, balances, mode transfer, conversion quote/confirm, builder consent, BTC/ETH order review (size, leverage, margin, fee), reduce-only close, cancel, journal + fills | `next build` passes; **not exercised in a browser** |

## Phase 3 gate: partially passed (7 Oct)

- [x] Balances reconcile after fill, partial (unit), rejection (tx: 10 USDC minimum), timeout/lost response (tx)
- [x] Retry after an unknown result cannot create duplicate exposure (tx + unit, including the info-lag case)
- [x] Attributed testnet fills exist (builderFee on fills), but builder = own account: mechanics only, not revenue
- [ ] Real XZEC conversion (no testnet liquidity)
- [ ] `/trade` exercised in a real browser (two tabs, reload)
- [ ] Builder = a separate team builder account with ≥100 USDC perps value

New constraints learned: HL minimum order value is 10 USDC (applies to conversions both ways, so small residuals cannot be converted); spot buy fees are taken in the base token; info API can lag the exchange by >1.5 s.

# Phase 4 status (8 Oct 2026)

| What | Evidence |
|---|---|
| Unit return route (`src/lib/bridge/returns.ts`): transparent P2PKH destination only, network check, guardian 2-of-3 on the withdrawal payload (`coinType "ethereum"`) | live mainnet + testnet captures, unit tests |
| Testnet return address generation works for fresh `tm…` destinations (earlier 400s were from reusing Unit's own address) | live, `scripts/probe-withdraw.ts` |
| Return plan: whole free balance, truncated to token decimals, 0.07 ZEC floor, net of live outbound fee; residual options (only tested routes called working) | unit tests |
| Return send journaled before signing; unknown/pending blocks resend; ledger reconciliation by nonce; 10 min "not landed" wait | unit tests |
| Return states incl. `delivered_transparent` ("open the wallet and shield") and `user_marked_shielded`; Unit failure → manual recovery | unit tests |
| Balance accounting (user control / bridge op / residual / manual recovery / unaccounted) | unit tests; live read via recovery client |
| `/return` screen; recovery client now lists Unit operations | `next build`; recovery read run live (0 ops, 399.89 perps + 93.13 spot USDC) |
| `docs/RUNBOOK.md` | — |

## Phase 4 gate: NOT passed for the real route (8 Oct)
- [x] Every current test balance is accounted for (all `user_control`; no bridge ops, no residuals)
- [x] Below-minimum residual case demonstrated (unit tests; no live XZEC to show it on-chain)
- [ ] A real Unit return sent and delivered (blocked: no XZEC on HL because no testnet deposit settled)
- [x] Storage clearing, tab closure (crash-pending), two tabs, stale reads and Unit/HL outages exercised in headless Chromium against live testnet APIs (9 Oct, `scripts/e2e-browser.mjs`, 21/21). Also closes the Phase 2/3 "not run in a browser" items for read paths and browser CORS
- [x] Cleared-storage gap fixed: HL ledger pre-check before every return send
