# Trading from Shielded ZEC: Revised Product Requirements and Build Plan

**Version:** 2.1, adds findings from reading the protocol docs on 4 October  
**Updated:** 4 October 2026, Asia/Kolkata  
**Status:** Testnet prototype specification; mainnet pilot conditional on the gates below  
**Team:** Two people  
**Event:** Colosseum Crypto World's Fair, 14 September–12 October 2026  
**Internal submission target:** 11 October; confirm the exact official cutoff and timezone in the submission portal  
**Product name:** TBD

This document replaces the supplied build specification. The product remains a standalone website for funding a fresh Hyperliquid account from Zcash, trading, and returning funds to a Zcash wallet. It changes the dependency order and corrects the funding, testnet, custody, recovery, and return assumptions. Read `Research-Findings.md` for the observations and `Build-or-Stop-Decision.md` for the detailed investment case.

**Changes in v2.1 (from reading the protocol docs on 4 October):**
- Guardian verification needs signatures from 2 of the 3 guardians, not all three. Pin the published mainnet and testnet public keys.
- Unit requires 100 Zcash confirmations for a deposit, about 125 minutes. That delay is built into the protocol.
- The HL testnet faucet pays only addresses that have deposited on mainnet. Fresh accounts must be funded by a transfer from a team wallet.
- The ZEC perp is delisted on HL testnet. Testnet trading uses BTC or ETH.
- `ApproveBuilderFee` must be signed by the account's main wallet, not an agent or API wallet.
- TEX support exists in the core Zcash wallet library and in the Zashi/Zodl wallet. Zodl testnet availability is unconfirmed.
- Unit's testnet announcement does not list Zcash, although XZEC appears in the testnet token list.

## 1. Product and mission

Help an existing shielded ZEC holder use a separate Hyperliquid trading account without funding it from a previously identified public EVM account. Keep account control with the user and provide a clear route back to Zcash.

**Pitch:** "Fund a fresh trading account from Zcash. Keep your wallet history separate."

**Target user:** A shielded ZEC holder who already trades perps and is willing to use a separate trading identity. For the first release, the user must also have a supported EVM wallet. A Zodl user with no EVM wallet is a future onboarding segment, not a completed release-one flow.

**Privacy claim:** Zcash shields prior wallet activity. Fresh trading accounts avoid deliberate reuse of an identified public account. The bridge path, trading, timing, transfer amounts, and return transfers remain observable. The app does not provide confidential positions or prove resistance to transaction correlation.

**Research correction:** Unit's observed mainnet ZEC deposit address is TEX (`tex1…`). ZIP 320 says a wallet spending shielded funds to a TEX address **MUST** create two transactions. The first unshields to an ephemeral transparent address; the second sends from it to the TEX address. Unit can refund to that ephemeral address. Preserve the supplied TEX address; never convert it to a normal address to bypass source restrictions. [ZIP 320](https://zips.z.cash/zip-0320)

The opportunity is reliable orchestration and a better user experience. Ordinary wallet tools can already create fresh accounts and send shielded funds toward transparent destinations. Avoid presenting this application as a new anonymity protocol.

**Demand:** Bitquery reports approximately $10B notional and 29,622 ZEC perp trading accounts in August 2026. That measures the existing trading market, not the number of shielded ZEC holders willing to use this application. Its assertion about traders not using shielded transactions cannot establish their activity in private wallets. Obtain direct customer evidence. [Bitquery investigation](https://www.bitquery.io/investigations/hyperliquid-zcash-marketing-department)

**Prior art:** ShieldTX's published description uses EVM USDC and separate position accounts. Zypher Trade describes ZEC funding, NEAR swaps, service-executed trades, and ZEC returns. Its custody model needs a code review before making comparative security claims. Zodl already offers CrossPay and swaps. Our candidate distinction is user-controlled trading accounts, explicit recovery, and the complete funding-to-return workflow. Do not use "first" or "nobody does this" without a current competitor review. [ShieldTX](https://blog.availproject.org/why-we-built-shieldtx-private-perp-trading-on-hyperliquid/), [Zypher Trade](https://devfolio.co/projects/zypher-trade-f540), [Zodl](https://zodl.com/)

## 2. Operating rules

1. Mainnet API checks and testnet development begin together. Reading mainnet metadata does not require a funded mainnet transaction.
2. Classify every claim as live API observed, documented, transaction demonstrated, user tested, or unresolved. A successful address response is not a demonstrated bridge transfer.
3. The application never receives the user's Zcash seed. User trading secrets stay in the client, except an explicitly requested encrypted recovery export. No secrets enter telemetry, server logs, or local storage.
4. The app operator does not custody mainnet deposits. Unit controls backing ZEC through its guardian network; this is a bridge and wrapped-asset trust dependency, not an entirely trustless path.
5. Testnet, replayed fixtures, and mainnet have distinct labels. Simulation is never presented as settlement evidence.
6. Build and test recovery before funding externally controlled accounts. Clearing local state must not lose access to money.
7. New-risk checks must not arbitrarily block cancellation or reduce-only closes. Network failures, liquidity, minimum balances, and bridge failures can still prevent an action; describe those honestly.
8. Do not automatically retry an order, conversion, or transfer whose outcome is unknown. Reconcile against fills, balances, and operation history first.
9. Funding, conversion, builder approval, and withdrawal require informed user confirmation. If a user chooses automatic conversion, persist that consent and its maximum amount and slippage.
10. Show "confirmed" only with corresponding evidence. A spent transparent output does not prove receipt in the user's shielded account.
11. Testnet success permits consideration of a team mainnet pilot. It does not establish production readiness.
12. Once a real operation starts, preserve its receipt and recovery instructions even if a later gate fails.

## 3. Research ledger: what is known on 4 October

No funds were sent, orders placed, wallets signed, or personal wallet credentials accessed during this research. Calls used public documentation example addresses. Those addresses are research fixtures and must never appear as user deposit or withdrawal defaults.

| Finding | Evidence level | Build implication |
| --- | --- | --- |
| Mainnet `/gen/zcash/hyperliquid/zec/<hl-address>` returned HTTP 200 and a TEX address | Live API observed | Implement TEX recognition and confirm the wallet's two-transaction handoff |
| Repeating that request returned the same address | Live API observed | Stable mapping; a new account is needed for a new deposit identity |
| Mainnet `/gen/hyperliquid/zcash/zec/<valid-t1-address>` returned HTTP 200 | Live API observed | Address generation works for the sample; settlement remains untested |
| Mainnet deposit and withdrawal responses carried valid signatures from all three guardians | Locally verified from live responses | Integrate signature checks before a payment QR or withdrawal confirmation |
| Unit's verification code sets `GUARDIAN_SIGNATURE_THRESHOLD = 2` and publishes separate mainnet and testnet guardian public keys | Documented | Accept 2 of 3 valid signatures; pin the network-specific keys; reject anything below the threshold |
| Deposit guardian verification matched the underlying P2PKH encoding, rather than the displayed TEX string | Locally verified | Verify encoding equivalence; retain TEX for the actual payment |
| Mainnet fee API reported 0.005681404 ZEC inbound and 0.00015 ZEC outbound, with estimates of 126m and 130m. Docs example shows 0.00581428 inbound | Live snapshot + documented | Fees vary; always read `/v2/estimate-fees` live; do not promise a five-minute return |
| Unit requires 100 Zcash confirmations, about 125 minutes | Documented; matches the live ETA | The deposit delay is built into the protocol; record demos in advance |
| Unit documents a 0.07 ZEC minimum; deposits below it "are unable to be processed" and are reprocessed only if the minimum later drops | Documented | Block sub-minimum funding in the UI; warn that short deposits are stuck |
| Unit's API overview says 2,000 HL confirmations; its withdrawal lifecycle says 5,000 | Conflicting documentation | Keep unresolved; live operations and Unit clarification determine behavior |
| Unit testnet generated a Zcash `tm…` deposit address; all three guardian signatures verified | Live API observed + local verification | Attempt a real testnet bridge before building a simulator |
| Unit's testnet announcement lists HL testnet, Bitcoin Signet and Ethereum Sepolia, not Zcash | Documented | Zcash testnet support may be partial; keep the one-day investigation limit |
| Testnet withdrawal generation returned HTTP 400 for the tested destinations | Live API observed, limited samples | Real testnet return is unresolved; do not infer universal outage or support |
| Official Unit testnet token metadata lists XZEC, ID `0xc8e8047efa1400eb0b7b9bbee16b759d` | Documented and matched against live HL metadata | Use token identity, not the first token called ZEC |
| XZEC resolved to testnet market `@1401`; its observed order book was empty | Live API observed | Testnet conversion needs liquidity or a clearly labeled substitute |
| A different testnet token named UZEC also existed, at `@1326`, with an empty book | Live API observed | Name matching alone can select the wrong asset |
| Mainnet Unit Zcash ID `0x1c994ad3381d31c86c8c2d74ed89a365` resolved to UZEC, token index 419 and market `@272` | Live API observed (re-checked 4 Oct) | Market order asset index is 10000 + 272; transfer token selector differs |
| Mainnet `@272` book had a tight spread near $1,313 with about 1–15 ZEC at the top levels | Live snapshot, 4 Oct | Pilot-sized conversions are feasible; still use price-bounded IOC |
| Mainnet ZEC perp is listed with 10x max leverage | Live API observed | ZEC perps are available for the mainnet pilot |
| Testnet ZEC perp is marked `isDelisted: true` | Live API observed | Testnet trading uses BTC or ETH, not ZEC |
| HL testnet faucet gives 1,000 mock USDC only to addresses that have deposited on mainnet | Official HL documentation | Fresh derived accounts cannot use the faucet; fund them by transfer from a team wallet that has deposited on mainnet |
| Unit generation/fee responses included `Access-Control-Allow-Origin: *` for the probe | HTTP header observed | Promising for browser access; complete a real browser/preflight check |
| The core Zcash wallet library (`zcash_client_backend`) has TEX-specific handling, including an `UnsupportedTexAddress` error | Documented in library changelog | Wallets built on the library can support TEX; wallet compatibility still needs a hands-on test |
| The Zashi wallet (now Zodl) changelog includes "a mechanism for discovering failed TEX transaction funds" and better TEX error handling | Documented | The main wallet handles TEX, including failures between the two transactions |
| ZIP-321 is Active; wallets SHOULD check that each address matches the network | Documented | Validate the network of every address in the QR before showing it |
| Zodl testnet availability | Unresolved | Plan testnet sends with zcash-cli, Zingo or another testnet-capable wallet |
| Zodl describes a prompt and one tap to shield transparent receipts | Official product documentation | Return flow ends with a wallet action; do not assume silent autoshield |
| Builder fee approval needs a builder with at least 100 USDC in perps account value, in standard mode. `ApproveBuilderFee` must be signed by the main wallet, not an agent. Each user can have at most 10 active builder approvals | Official HL documentation | Make fee approval explicit; sign it with the trading account's own key; test it after ordinary trades work |
| Maintained SDKs: `@nktkas/hyperliquid` 0.33.3 (TypeScript), `hyperliquid-python-sdk` 0.24.0 | Package registries, 4 Oct | Pin versions; verify SDK behavior against the docs |

Raw responses and verification methodology are summarized in `Research-Findings.md`. Values above are observations, not permanent constants.

## 4. Testnet strategy and fallback

The primary plan is a real Unit testnet integration attempt. The original assertion that Unit has no Zcash testnet route is too strong: address generation and an officially documented testnet token now exist. However, Unit's testnet announcement does not list Zcash, and we have not demonstrated a funded testnet bridge or a working testnet withdrawal.

Two Hyperliquid testnet constraints shape the plan:

- **Faucet access.** The faucet pays only addresses with a mainnet deposit. A team wallet that has deposited on mainnet claims the mock USDC and transfers it to each fresh testnet trading account. Record these transfers as test-only funding. They are not part of the privacy route.
- **No ZEC perp.** The testnet ZEC perp is delisted, so testnet trading demonstrations use BTC or ETH.

Use these separate test lanes:

| Lane | What it demonstrates | What it cannot demonstrate |
| --- | --- | --- |
| Real Unit testnet deposit, if it settles | Zcash transaction → guardian operation → correct HL test token | Mainnet wallet UX, mainnet timing, or mainnet economics |
| Real HL testnet BTC/ETH trade funded with mock USDC sent from a team wallet | Signing, orders, close, cancellation, balances, builder approval | A successful ZEC bridge, spot conversion, or ZEC perp trading |
| Controlled testnet liquidity, if supported and available | Real testnet XZEC conversion fills | Natural mainnet liquidity or execution quality |
| Replay adapter using saved Unit responses | UI states and fault handling | Movement of Zcash or token minting |
| Capped team mainnet round trip, after gates | Actual wallet, bridge, conversion, ZEC perp trading and return path | Production security or broad market demand |

Timebox the real testnet bridge investigation to one working day. If payout or liquidity remains blocked, keep real HL testnet trading and use a fixture adapter for the missing UI states. Do not spend several days building a treasury-funded custodial fake bridge. A replay adapter is a development tool, not a substitute route.

## 5. Architecture, custody, and keys

```text
Supported EVM wallet                 Zcash wallet
        |                                |
        | unlock or externally sign      | wallet builds Zcash payment
        v                                v
Browser application                wallet-managed TEX handoff on mainnet
  - account control and recovery     (unshield → ephemeral t-addr → TEX)
  - Hyperliquid client                    |
  - Unit route adapter                    v  100 confirmations (~125 min)
  - nonsecret local journal          Unit guardian-controlled address
  - explicit action confirmations         |
        |                                 v
        |                            HL Unit token
        +-------------------------------> spot conversion → USDC margin
                                         → public perp trading
                                         → buy Unit token → Unit return
                                         → user's transparent wallet address
                                         → user shields in wallet
```

### Key design

Sign-to-derive remains a candidate for the testnet prototype, subject to an early recovery gate. A signature used as key-derivation input is a master secret: disclosure can expose every derived trading account. Putting the domain in the signed message does not stop a fake site requesting the same message. EIP-712 specifies structured signing and domain separation, not guaranteed signing-origin enforcement. [EIP-712](https://eips.ethereum.org/EIPS/eip-712)

Before this account mode receives funds:

- Freeze the exact typed-data schema, canonical signature encoding, derivation version, domain identifier, and account index conventions. Do not derive from a changing deployment hostname, current time, or incidental wallet network.
- Use reviewed cryptographic libraries and publish deterministic test vectors. Review conversion to a valid secp256k1 scalar; do not leave it as unspecified `toValidSecp256k1Key` pseudocode.
- Test re-derivation on another browser and after wallet reconnect. Two matching signatures are a compatibility observation, not a lifelong wallet guarantee.
- Provide a downloadable recovery client and explicit backup instructions. Test it with site and app server unavailable and local storage cleared.
- Keep network-separated testnet/mainnet account namespaces. Do not reuse a published testnet address as a mainnet privacy account.
- Recover the initial account directly from index 0. Export a nonsecret account-index manifest for later accounts; warn that this manifest links the listed accounts if shared.
- The derived account is the Hyperliquid main wallet for that identity. `ApproveBuilderFee` and withdrawals must be signed with the derived key itself, not with an agent or API wallet.
- Require a security review of the candidate derivation and secret-handling code before any public mainnet use.

If this cannot pass on schedule, use a separately created, fresh EVM account controlled by the user's wallet extension and standard external-wallet signing. Explain that it is a dedicated trading identity; do not silently substitute the user's existing public account. Implement one account in the hackathon MVP; multiple deterministic accounts can follow later.

Browser memory limits persistence, but does not defend against malicious site JavaScript, compromised dependencies, extensions, or phishing. Treat that as a real product tradeoff.

### Adapter boundaries

- `UnitBridgeAdapter`: address generation, guardian verification bound to the address (2-of-3 threshold, pinned per-network keys), fee estimates, actual operations and raw status preservation.
- `ReplayBridgeAdapter`: deterministic saved responses and failure states, visibly labeled.
- `HyperliquidClient`: token identity resolution, account mode, nonce management, orders, transfers, fills and reconciliation.
- `ZcashHandoff`: address/network parsing, including TEX and testnet `textest`; ZIP-321 URI construction with a network check; wallet instructions. The site does not hold Zcash spending keys.
- `RecoveryClient`: minimal account access, balances, cancel, reduce-only close, and recovery/export instructions.

Mainnet and testnet use separately pinned token identities and guardian keys. Production mode cannot instantiate a replay adapter. A proxy, if ultimately needed, receives only the minimum public request data and cannot substitute unverified deposit addresses.

## 6. User flows and state

### Unlock and recover

Explain the supported account mode and its recovery responsibility. Check account recovery before showing a deposit QR. On reconnect, reconstruct balances from HL; read-only access works without signing. Signing is needed only when the user takes an action.

### Fund

1. Resolve the current network and correct trading account.
2. Fetch the Unit mapping, verify at least 2 of 3 guardian signatures against the pinned network keys, and verify address/network encoding.
3. Show amount, fees, the 0.07 ZEC minimum and the fact that smaller deposits get stuck, an expected time of about 2 hours (100 Zcash confirmations), TEX implications on mainnet, and the eventual USDC conversion.
4. Obtain explicit consent. The user scans ZIP-321 or copies the address into the tested Zcash wallet. Verify that the wallet supports this particular destination type.
5. Preserve the mapping and observed deposit/operation IDs. Poll statuses, then reconcile with actual token balance. Do not make the user send again because the API timed out.

Mainnet payment QR must contain Unit's returned TEX address. Funding from an already shielded wallet must not combine unrelated public funds in the transparent handoff. Actual wallet coin selection is a wallet compatibility gate.

### Convert and prepare

Sell the received Unit token for USDC with a price-bounded IOC order. Treat a partial fill as a partial fill. Re-read balances; do not claim the entire deposit has become margin. Require consent before changing risk or retrying at a wider slippage limit.

Read account abstraction mode and move USDC between spot/perps only if the chosen mode requires it. Approve the builder fee with visible user consent, signed by the trading account's own key. The proposed 0.05% fee uses `f: 50`, since the field is in tenths of a basis point. Users can have at most 10 active builder approvals; handle the case where the limit is already reached. [Builder codes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes)

### Trade

MVP supports one liquid perp chosen from live metadata, market-style IOC orders, positions, cancellation where applicable, and reduce-only close. On testnet, use BTC or ETH because ZEC is delisted there. Expand to arbitrary markets and limit-order management after the complete lifecycle works. Every new order shows size, leverage, margin and fee. Unknown results reconcile via a client order ID before retry.

### Return

1. Cancel outstanding orders and close positions the user selects. Show any remaining exposure.
2. Confirm available funds and a freshly obtained return address controlled by the user's Zcash wallet.
3. Check the Unit return minimum, conversion liquidity and fees. If insufficient, show the exact residual and documented recovery alternatives; never promise every residual can return as ZEC.
4. Buy the correct mainnet Unit token; reconcile the actual fill. Preview the amount to be sent and net estimated payout.
5. Generate the Unit withdrawal address and verify it with 2-of-3 guardian signatures. Send only the correct spot token with explicit confirmation.
6. Follow the operation and destination transaction. On a transparent payout, display "Delivered to your Zcash wallet — open the wallet and shield."
7. Wallet confirmation or demonstrable wallet integration is required to label shielding as wallet-confirmed. A user tick alone is "you marked this shielded"; a transparent output being spent is "transparent output spent."

### State model

```text
account_ready → awaiting_deposit → deposit_seen → bridge_pending
→ unit_token_received → conversion_pending → partially_converted / margin_ready
→ trading → closing → return_conversion_pending → return_token_ready
→ bridge_return_pending → delivered_transparent → shielding_pending
→ wallet_confirmed_shielded (only with wallet evidence)

Any action may enter outcome_unknown, recoverable_error, or manual_recovery.
A deposit below the 0.07 ZEC minimum enters below_minimum_stuck.
Reconcile unknown outcomes before allowing a duplicate spend or order.
```

## 7. Privacy model

| Observer | What can be learned | What remains outside the intended public trail |
| --- | --- | --- |
| Public Zcash observer | Exit amounts, the transparent handoff through an ephemeral address, and return transfers | Shielded transaction details and prior note ownership |
| Public HL observer | Funding, positions, fills, liquidation levels, PnL and withdrawals | Off-chain root-wallet signature, if kept secret |
| Unit guardians/API | Deposit-to-HL and return-destination mapping; request metadata | User's Zcash seed and trading key |
| HL API/provider | Requests, queried accounts, IP/network metadata | No promise against service-level account correlation |
| App host or compromised browser code | Potentially sensitive client activity and secrets | Browser-only storage is not protection from malicious code |

Freshness and careful account use reduce deliberate identity reuse. Standard amounts and local delays are experimental heuristics, not a guaranteed anonymity set. They are deferred from the hackathon critical path. In particular, the public bridge leg can remain attributable even when the shielded savings history is hidden.

Testnet faucet funding from a team wallet links test accounts to that wallet. This is acceptable only on testnet. Never use that pattern on mainnet.

Do not claim a shielded balance becomes publicly known merely because a withdrawal is unshielded. Amount and timing leakage matter, but disclosure of the full stash is a different claim. Do not claim that Unit, HL, an API proxy, or a colluding provider cannot correlate activity.

Optional waitlist/feedback must be separate from trading identifiers. Do not join email addresses, parent EVM accounts, Zcash return addresses, and derived accounts into analytics. Show opt-in usage metrics only with defined collection and retention.

## 8. Fees and economics

The live Unit ZEC snapshot was 0.005681404 ZEC inbound and 0.00015 ZEC outbound; Unit's docs example shows 0.00581428 inbound, which confirms the fee moves. At a 0.1 ZEC deposit, the inbound fee alone is approximately 5.7% of the deposit. At 1 ZEC it is approximately 0.57%. Network fees, activation, conversion spreads, trading fees and builder fees add to this. These are snapshot calculations, not quoted prices. [Live fee endpoint](https://api.hyperunit.xyz/v2/estimate-fees)

New HL accounts require an activation fee of one quote token. Confirm who pays it in the Unit deposit path rather than having a simulator subsidize it and conceal the difference. [Activation fee](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/activation-gas-fee)

The documented Unit minimum is 0.07 ZEC. Deposits below it cannot be processed and are only reprocessed if Unit lowers the minimum. Use it as the current documented constraint and confirm both directions in the pilot. Trading losses, rounding, spreads and fees can reduce funds below the return minimum. The product must expose this possibility before accepting a funding plan. [Address/minimum documentation](https://docs.hyperunit.xyz/developers/api/generate-address.md)

**Pilot proposal:** 0.1–2 ZEC per dedicated account, but enforce both a ZEC limit and an operator-selected fiat risk budget. The minimum is not a recommendation. If the necessary route amount exceeds the budget, remain on testnet. Standard amount suggestions above 2 ZEC are disabled while this pilot cap applies. The observed mainnet `@272` book depth supports conversions in this range.

**Revenue hypothesis:** 0.05% of attributed perp notional. At $1M monthly volume, gross builder revenue is $500; at $10M it is $5,000. These are arithmetic scenarios before partner shares, operations and support, not traction. Measure repeat traders and attributable volume; bridge turnover is not revenue. The builder account must keep at least 100 USDC in perps account value, in standard mode.

## 9. Technical requirements

Use Next.js, TypeScript, a maintained HL SDK (currently `@nktkas/hyperliquid` 0.33.3), reviewed wallet/crypto utilities, and a small local operation journal. Lock dependencies and record versions. A library's documentation is evidence of an interface, not proof that our integration works.

```text
src/lib/accounts/     account mode, unlock, recovery
src/lib/hl/           metadata, orders, fills, transfers, nonce/reconciliation
src/lib/bridge/       Unit adapter, guardian checks (2-of-3, pinned keys), operation parsing
src/lib/replay/       development-only fixture adapter
src/lib/zcash/        address parsing (incl. TEX/textest), ZIP-321, wallet handoff
src/lib/store/        nonsecret journal and account-index manifest
recovery/             standalone recovery client
docs/VERIFIED.md      evidence ledger and unresolved questions
docs/TEST_EVIDENCE.md actual transaction traces
docs/PRIVACY.md       actual observer model
docs/RUNBOOK.md       failures and recovery
```

Acceptance tests must address money-handling failures rather than simply mirror helper implementations:

- Tampered guardian address, destination, network, signature or token identity is rejected. Fewer than 2 valid guardian signatures is rejected, and so are signatures from the other network's keys.
- A ZIP-321 URI containing an address for the wrong network is rejected.
- A funding amount below 0.07 ZEC plus fees is blocked before the QR is shown.
- No secret is persisted or sent through request logging/telemetry; locally exported encrypted recovery is explicit.
- Duplicate clicks, a timeout after submission, reload and two tabs cannot create an uncontrolled duplicate order/withdrawal. Nonces and client order IDs are handled per account.
- Partial IOC conversions do not overstate funds; minimum and decimal precision are derived from current metadata.
- Position close is reduce-only; builder approval failures (including the 10-approval limit) do not disable recovery actions.
- Existing bridge operations survive restart; statuses may be reconciled backward after a reorg or inconsistent provider read.
- Returning below the route minimum shows residual funds and a manual recovery path.
- Delayed local actions, if later implemented, stop when the tab is closed. They resume only after reopen/unlock and renewed checks; do not imply browser background signing.

For the observed mainnet spot pair, the order selector is `10000 + marketIndex`; `spotSend` requires the protocol's token selector, not `@272`. Resolve and validate both at runtime. [HL exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)

## 10. MVP screens

| Screen | Required behavior |
| --- | --- |
| Landing | Specific audience, concrete workflow, clear privacy limit |
| Unlock/recovery | Account mode, restoration instructions, no Zcash seed request |
| Fund/status | Verified QR, correct address type, fees, 0.07 ZEC minimum, ~2-hour wait, operation evidence |
| Trade | One perp (BTC/ETH on testnet), order review, position, close/cancel, current balances |
| Return/status | Return minimum, destination review, bridge evidence, wallet shielding instruction |
| Privacy/help | Observer table and usable recovery steps |

Charts, broad market coverage, a multi-account dashboard, and automatic delay controls are optional after the end-to-end trace works. Testnet banners and fixture labels are required everywhere they apply.

## 11. Revised build phases and gates

Dates below are planning targets from 3 October, not estimates of completed work. Owner A leads integrations and transaction state; owner B leads UI, recovery UX, tester coordination and submission. Both review signing and exits. Research and customer conversations can proceed alongside code.

### Phase 0 — Confirm dependencies and choose the test lanes

**Target:** 3–4 October. Maximum one working day of additional route investigation.

**Build/research**

- [x] Record mainnet Unit deposit/withdrawal address responses, stable mapping, fees and CORS headers.
- [x] Verify guardian signatures from the sampled responses; document TEX-to-P2PKH equivalence for verification.
- [x] Match official mainnet/testnet token identities against live HL metadata and inspect books.
- [x] Read Unit, ZIP 320/321 and HL docs: 2-of-3 threshold, 100 Zcash confirmations, 0.07 ZEC minimum, faucet restriction, testnet ZEC delisting, builder-signing rules.
- [x] Confirm TEX support in the core Zcash wallet library and in the Zashi/Zodl changelog.
- [ ] Replace public example addresses with team-controlled addresses before transaction testing; never fund the examples used in this research.
- [ ] In an actual browser, verify generation/status access and any needed preflights.
- [ ] Select a compatible Zcash testnet wallet (zcash-cli, Zingo or similar; Zodl testnet is unconfirmed) and obtain valueless test coins. Test address parsing and shielded sending.
- [ ] *(7 Oct: blocked, no Zcash testnet coins yet)* Attempt one real Unit testnet deposit and, if supported, one withdrawal. Record failure bodies and operation states. Timebox; address generation alone does not mark this complete.
- [ ] Confirm official XZEC liquidity or arrange explicitly labeled testnet liquidity if available without substantial additional work. *(7 Oct: XZEC, UZEC and BZEC books all empty; no liquidity arranged)*
- [x] Confirm a team wallet that has deposited on mainnet exists, so it can claim faucet mock USDC. *(7 Oct: team wallet claimed and sent 500 mock USDC)*
- [ ] Test Zodl's mainnet TEX/ZIP-321 handoff and return-address UI with a teammate's wallet preview; actual transfer remains later.
- [ ] Confirm submission requirements in the current portal. Prepare a 2–3 minute pitch and a technical demo no longer than three minutes; the original five-minute plan conflicts with the current FAQ.

**Customer work, alongside the above:** interview five people who both hold shielded ZEC and trade perps. Ask about their existing route, funding frequency, two-hour waits, fees, public positions, recovery and willingness to use this flow. A forty-response poll is optional and not an engineering gate. Seek three people willing to complete the testnet lifecycle.

**Decision:** choose real Unit testnet deposit/return where demonstrated, real HL testnet trading, and fixtures for only the unavailable pieces. If no usable real ZEC route or wallet handoff exists, stop expanding the bridge flow and reassess Unit versus an existing Zodl swap route.

### Phase 1 — Account control, recovery and minimal testnet trading

**Target:** 4–5 October. This can begin while Phase 0 route tests finish.

**Build**

- [x] Scaffold the app, freeze network/token configuration, guardian keys and dependency versions.
- [x] Implement one user-controlled account. Test candidate sign-to-derive and its recovery; use the dedicated-wallet fallback if the gate fails. *(7 Oct: dedicated-key fallback; sign-to-derive not built)*
- [x] Claim faucet mock USDC with the team wallet that has deposited on mainnet, then transfer it to the fresh testnet trading account. Record the transfer as test-only funding and record who paid activation. *(7 Oct: done; activation payer still unconfirmed)*
- [x] Read balances and metadata; place and close a small BTC or ETH testnet position without builder fees first. *(7 Oct: see docs/TEST_EVIDENCE.md)*
- [x] Ship the basic recovery client and nonsecret public operation journal.

**Gate:** a second browser restores the same account after local data loss; a teammate can read balance, close and control the remaining funds with the app server unavailable. If recovery fails, block deposit QR generation and new-risk actions. Do not wait until the post-hackathon roadmap to build recovery.

**Gate status (7 Oct): passed.** From a fresh clone with no app server, the recovery client read the account (0 positions, 399.93 USDC perps, 100 USDC spot) and the key from `.env` was confirmed to control `0x1f20…85c0`. `--exit` was shown closing a live position in Phase 1b. Known gap: the code expects `TRADING_PRIVATE_KEY` in `.env.local`, but the key is stored as `TESTNET_TRADING_PRIVATE_KEY` in `.env`.

### Phase 2 — Funding and bridge status, using the selected lane

**Target:** 5–6 October.

**Status (7 Oct):** built and unit-tested on replay fixtures; the gate is met only for the fixture lane. **Gate not yet passed:** a real testnet deposit is blocked on Zcash testnet coins (team zingo-cli testnet wallet created, balance 0; faucets down), and `/fund` has not been run in a browser.

- [x] Implement Unit address generation, 2-of-3 guardian checks bound to the address against pinned keys, network/address-type parsing, fees, minimum enforcement and operation states. *(7 Oct: `src/lib/bridge/unit.ts`, `funding.ts`, `src/lib/zcash/address.ts`)*
- [x] Implement ZIP-321 QR with a network check, plus address-copy fallback in the chosen wallet. *(7 Oct: `/fund`; not yet scanned by a real wallet)*
- [ ] Follow a real testnet deposit if the Phase 0 lane settled successfully.
- [x] Where necessary, implement small replay fixtures for absent responses, delays (including the ~125-minute confirmation window), failures and partial states. Label the fixture lane on every relevant screen.
- [x] Confirm funds by token balance and operation evidence; deduplicate deposits by actual transaction/output identity. *(7 Oct: unit tests only; no real deposit yet)*

**Gate:** the UI shows the correct funding state after a reload, preserves existing operations after provider errors, and cannot suggest a second deposit because polling failed. Only a real settlement trace is labeled bridge-demonstrated.

### Phase 3 — Conversion, trading fees and reliable orders

**Target:** 6–7 October.

**Status (7 Oct):** built; gate passed for HL testnet orders, not for XZEC conversion. See `docs/STATUS.md` and `docs/TEST_EVIDENCE.md`.

- [x] Implement Unit token → USDC and USDC → Unit token as separate operations with price bounds and partial-fill handling. *(7 Oct: `src/lib/hl/spot.ts`; 10 USDC HL minimum enforced)*
- [x] Test the correct testnet token if live liquidity exists. Otherwise test conversions with controlled liquidity or fixtures and record the limitation. *(7 Oct: XZEC has no bids, so it is refused; both directions filled on substitute PURR/USDC, labelled as not XZEC evidence)*
- [x] Implement mode-dependent margin transfer and explicit builder-fee approval signed by the trading account's own key. Keep ordinary close/cancel access available if builder setup fails. *(7 Oct: builder still = own account; a separate funded builder account is open)*
- [x] Add client order IDs, account-scoped nonce coordination and unknown-outcome reconciliation. *(7 Oct: signed `expiresAfter`; a live run caught and fixed a false "not landed" caused by info-API lag)*
- [x] Finish one-perp trading UI, order review, cancellation, reduce-only close and fill evidence. *(7 Oct: `/trade`; builds, not yet run in a browser)*

**Gate:** balances reconcile after a fill, partial fill, rejection and timeout. A retry after an unknown result cannot create duplicate exposure. Revenue evidence requires actual attributed testnet fills; fixtures do not count.

### Phase 4 — Return and recovery under failure

**Target:** 7–8 October.

**Status (8 Oct):** built and unit-tested; the real return is blocked behind the same missing testnet deposit. See `docs/STATUS.md` and `docs/RUNBOOK.md`.

- [x] Implement the chosen testnet return lane or display its documented limitation. *(8 Oct: live Unit testnet lane; `/return` states that no real return has been sent)*
- [x] Verify the return destination, spot-transfer token selector, net amount and route minimum. *(8 Oct: withdrawal guardian payload uses `coinType "ethereum"`, verified 3/3 live on both networks; earlier testnet 400s were from reusing Unit's own address)*
- [x] Add "Delivered to wallet — shield in wallet" instructions and evidence-specific shielding statuses.
- [x] Demonstrate the below-minimum residual case. Provide a balance-controlled recovery plan; any alternate USDC withdrawal route must itself be tested before advertised as functional. *(8 Oct: unit tests only; no USDC withdrawal route offered)*
- [x] Test clearing local storage, tab closure, stale reads and provider failure at each money transition. *(9 Oct: unit tests per transition + 21 headless-browser checks on live testnet APIs; no signing in the browser)*

**Gate:** every test balance is accounted for, either available under user control, in a recorded bridge operation, or in a known residual/manual-recovery state. A return simulator or fixture does not imply a working Unit return.

### Phase 5 — Conditional team mainnet smoke test

**Target:** 8–9 October, only if all applicable gates pass. Start the deposit early in the day: each direction takes about 2 hours.

This is a team-run experiment, not a public mainnet release. The team supplies a dedicated account and an explicit loss budget. No real funds were moved by the research that produced this PRD.

- [ ] Verify the 2-of-3 guardian signatures on the actual team's Unit address and the actual wallet's TEX flow.
- [ ] Review account control and restoration. If the candidate derived-account design is not reviewed, use the tested dedicated EVM-wallet account path for this experiment.
- [ ] Refresh fees, minimums, liquidity, token identity, activation funding and a chosen fiat risk budget. Do not hardcode 0.1 ZEC as universally affordable or sufficient.
- [ ] Start with the minimum practical route amount within that budget, hold a small cash reserve, and run one tightly bounded ZEC perp trade after funding/conversion works.
- [ ] Close, convert back, generate a verified return route and confirm Zcash delivery; separately observe shielding in the wallet.
- [ ] Measure both directions. The docs require 100 Zcash confirmations (~125 minutes) and live estimates were about two hours each way, so reserve substantial time and record a video as events complete.
- [ ] Record all fills, fees, operations, transaction IDs, remaining dust and actual activation payer.
- [ ] Record the actual number of HL confirmations Unit waits for on withdrawal, to settle the 2,000-versus-5,000 conflict.

**Gate:** one real round trip with recoverable user control and no unexplained balance loss. If any prerequisite or budget fails, skip the experiment and submit the working testnet product with precise limitations. Fix defects before any public mainnet access. A single success does not establish safety for outside users.

### Phase 6 — External testers and submission preparation

**Target:** 8–10 October; can overlap with the team smoke test.

- [ ] Recruit three to five outside testnet users and record which parts are real and which are replayed. Plan their mock USDC funding: they likely lack a mainnet deposit, so send it from the team wallet.
- [ ] Capture time-to-first-trade, failures, support needed, exit completion and stated willingness to use the real route.
- [ ] Finish clear privacy/custody copy, fee review, concise README, evidence ledger and recovery instructions.
- [ ] Freeze optional functionality on 9 October. Fix only defects affecting the demonstrated lifecycle.
- [ ] Record a 2–3 minute pitch and a technical demo no longer than three minutes. Show the ~2-hour bridge steps as recorded, time-labeled clips. Current portal rules take precedence over old workshop material.

**Gate:** one reproducible testnet trace, a published limitation table, usable recovery, tester feedback and two accessible videos. Optional mainnet evidence is included only if completed.

### Phase 7 — Submit and preserve access

**Target:** 11 October, with 12 October reserved for submission problems rather than new features.

- [ ] Check current track eligibility and the official cutoff/timezone in the portal.
- [ ] Submit one product per team with an accurate record of pre-existing code and hackathon work.
- [ ] Verify repository, website and video access from an unrelated browser session.
- [ ] Leave testnet clearly labeled; keep public mainnet funding disabled unless the later release criteria are satisfied.
- [ ] Preserve recovery and evidence after submission.

### Scope decisions

**Cut first:** broad market coverage, charts, multiple account indexes, "Keep as ZEC," automatic local delays, amount heuristics, simulator custody service, rich analytics, public mainnet launch.

**Keep:** user account control, recovery, evidence labels, a real HL testnet open/close, correct token identities, minimum/partial-fill handling, explicit confirmations and a truthful exit status.

**Stop adding features when:** the core route is still unresolved on 6 October, recovery is still failing on 7 October, or no reproducible lifecycle exists by 9 October. Submit a smaller truthful prototype or pivot; do not mask these failures with additional UI.

## 12. Submission and pitch

Current Colosseum FAQ specifies a 2–3 minute presentation and a product demo of no more than three minutes. Confirm the event portal before final recording. [Submission FAQ](https://colosseum.com/hackathon)

| Pitch segment | Time budget | Content |
| --- | --- | --- |
| User and problem | 0:00–0:30 | A shielded holder wants a separately controlled trading identity and a usable return route |
| Product and demo excerpt | 0:30–1:20 | Funding status, actual trade, close, return with precise labels; bridge waits shown as time-labeled clips |
| Evidence and limits | 1:20–1:55 | Actual route lane, tester feedback, public trading and Unit dependency |
| Business and distribution | 1:55–2:25 | Attributed fees, direct customer evidence, prospective wallet distribution |
| Team and next milestone | 2:25–2:50 | Relevant skills and the specific uncertainty to resolve next |

Zcash angle: useful trading access for shielded holders, wallet handoff, and an explicit route back to shielding. HL angle: user onboarding, correct spot/perp lifecycle and attributed fees. General pool: customer evidence, execution and sustainable distribution. Track eligibility is a portal check, not assumed from the product title.

Say "the app does not custody your funds; the route uses Unit." Say "public funding and trading remain visible." Show where observations end. Remove "the trail just stops," "only the user holds funds" as a description of the entire bridge route, and "none could trade from private ZEC" as an unsupported claim about all historical traders.

Any proposed Zodl integration or fee-sharing partnership is marked proposed. Research and tester outreach can be prepared without contacting judges or posting on the user's behalf.

## 13. Post-hackathon roadmap

| Next milestone | Required evidence |
| --- | --- |
| Public mainnet readiness | Reviewed key/recovery design, complete failure handling, actual exit tests, bounded funding and appropriate operational review |
| Better wallet experience | Confirmed wallet capabilities and explicit partnership interest; eliminate the unnecessary second-wallet friction where feasible |
| Route competition | Compare Unit against Zodl CrossPay/NEAR routes on costs, latency, counterparties, recovery and metadata exposure |
| Privacy improvement | Defined adversaries, measurable linkage tests, traffic/batching analysis; no heuristic guarantee |
| Distribution | Repeat users and an actual wallet/community channel, not a mock partnership |
| Sustainable business | Repeat monthly attributed volume and gross/net revenue after support and partner costs |

Background signing is a separate custody and permissions decision. A trade-only agent does not automatically have the withdrawal authority needed to complete a return, and granting that authority changes the account security model. Builder-fee approval also cannot be delegated to an agent.

## 14. Reasons to continue, pivot, or stop

Continue the hackathon prototype if a real HL testnet lifecycle works, recovery is usable, and the interviews identify repeat users who accept the route's visible legs, costs and waits. Continue the Unit integration only if its real route can be demonstrated or its missing steps are accurately isolated.

Pivot to a funding/return adapter if traders value the route but prefer their existing HL interface. Compare a Zodl swap route if Unit's time and cost dominate usability. Continue as a grant-backed public component only if an integrator will use the reusable work and the proposal identifies incremental value.

Stop the mainnet plan if key recovery, address verification, token identification, route minimums or the exit path remain unresolved. Stop the larger startup investment if the target customers want confidential positions, immediate funding, or EVM-free onboarding that this version cannot provide, or if direct interviews show no willingness to use it.

The companion decision memo develops both the positive and negative case. Current recommendation: build the smaller testnet prototype and validate the actual customer overlap; keep mainnet and startup investment conditional.

## 15. Release rule

A testnet demonstration, a generated address, a verified guardian signature, and a real filled trade are four different pieces of evidence. None independently establishes the complete product.

Submission readiness requires real HL testnet account control and trading, truthful routing labels, recovery, a repeatable demo and customer feedback. Mainnet team pilot readiness additionally requires tested wallet behavior, verified mainnet route bindings, liquidity, an affordable amount and the return/recovery path. Public mainnet readiness requires further review and operational hardening. Keep those statuses distinct in the website and pitch.

## Sources and evidence

- [Research-Findings.md](Research-Findings.md): live API observations, signature verification, discrepancies, unresolved checks and reproducibility.
- [Build-or-Stop-Decision.md](Build-or-Stop-Decision.md): detailed reasons to pursue, pivot or decline the idea.
- [Unit API overview](https://docs.hyperunit.xyz/developers/api.md), [address generation](https://docs.hyperunit.xyz/developers/api/generate-address.md), [guardian verification](https://docs.hyperunit.xyz/developers/api/generate-address/guardian-signatures.md), [fees](https://docs.hyperunit.xyz/developers/api/estimate-fees.md), [testnet token identities](https://docs.hyperunit.xyz/developers/key-addresses/testnet/token-metadata-testnet.md).
- [Unit withdrawal lifecycle](https://docs.hyperunit.xyz/developers/api/operations/withdrawal-lifecycle.md), [guardian architecture](https://docs.hyperunit.xyz/architecture/components.md).
- [ZIP 320](https://zips.z.cash/zip-0320), [ZIP 321](https://zips.z.cash/zip-0321), [zcash_client_backend changelog](https://github.com/zcash/librustzcash/blob/main/zcash_client_backend/CHANGELOG.md), [Zashi Android changelog](https://github.com/Electric-Coin-Company/zashi-android/blob/main/CHANGELOG.md), [Zodl product documentation](https://zodl.com/), [EIP-712](https://eips.ethereum.org/EIPS/eip-712).
- [Hyperliquid exchange API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint), [builder codes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes), [activation fee](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/activation-gas-fee), [faucet](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet).
- [@nktkas/hyperliquid](https://www.npmjs.com/package/@nktkas/hyperliquid), [hyperliquid-python-sdk](https://pypi.org/project/hyperliquid-python-sdk/).
- [Current Colosseum FAQ](https://colosseum.com/hackathon), [Zcash track funding proposal](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/414).
