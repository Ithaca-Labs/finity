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
