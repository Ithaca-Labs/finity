# finity

**Fund a fresh trading account from Zcash. Keep your wallet history separate.**

finity is a standalone website that lets a shielded ZEC holder fund a brand-new Hyperliquid account from Zcash, trade perps from it, and send the proceeds back to a Zcash wallet. The user keeps control of the trading account throughout.

## The idea

Zcash holders who trade perpetual futures usually have to fund Hyperliquid from an identified public EVM account. That ties their trading to an existing public identity. finity gives them a separate trading identity and a defined route into and out of it:

1. **Fund**: send ZEC toward a fresh Hyperliquid account through the Unit bridge.
2. **Trade**: convert the bridged token to USDC margin and trade a perp.
3. **Return**: close positions, convert back, and withdraw to a Zcash address the user controls. The user then shields the funds in their own wallet.

The opportunity is orchestration and user experience. Fresh accounts and shielded sends already exist as separate tools. finity ties them into one complete funding-to-return workflow with explicit recovery.

### Target user

A shielded ZEC holder who already trades perps and is willing to use a separate trading identity. In the first release they also need a supported EVM wallet.


## Architecture

```text
Supported EVM wallet                 Zcash wallet
        |                                |
        | unlock or externally sign      | wallet builds Zcash payment
        v                                v
Browser application                wallet-managed TEX handoff
  - account control and recovery   (unshield -> ephemeral t-addr -> TEX)
  - Hyperliquid client                    |
  - Unit route adapter                    v  100 confirmations (~2h)
  - nonsecret local journal          Unit guardian-controlled address
  - explicit confirmations                |
        |                                 v
        |                            Hyperliquid Unit token
        +-------------------------------> spot conversion -> USDC margin
                                         -> public perp trading
                                         -> buy Unit token -> Unit return
                                         -> user's transparent Zcash address
                                         -> user shields in wallet
```

### Components

| Component | Responsibility |
| --- | --- |
| Browser app (Next.js, TypeScript) | Account control, order entry, state tracking, confirmations. Holds user trading secrets client-side only. |
| `UnitBridgeAdapter` | Generates deposit/withdrawal addresses, verifies guardian signatures (2 of 3, pinned per-network keys), reads fees and operation status. |
| `HyperliquidClient` | Token identity resolution, orders, transfers, nonce management, fill reconciliation. |
| `ZcashHandoff` | Address and network parsing (including TEX), ZIP-321 payment URIs. The site never holds Zcash spending keys. |
| `RecoveryClient` | Standalone client for reading balances, cancelling, and reduce-only closing, usable with the app server down. |
| Replay adapter | Development-only fixture adapter, labeled in the UI, never available in production. |

### Design principles

- **No Zcash seed, ever.** The app never receives it.
- **User-held trading key.** The trading account is the user's Hyperliquid main wallet. Secrets stay in the client and out of logs, telemetry and local storage.
- **Recovery first.** Access to funds must survive cleared local state and an unavailable server.
- **Evidence-based status.** "Confirmed" is shown only with matching evidence. Unknown outcomes are reconciled before any retry.
- **Honest labels.** Testnet, fixture and mainnet lanes are always distinguished.

### Funding path details

- Unit's mainnet Zcash deposit address is a TEX address. Per ZIP 320, a wallet spending shielded funds to one creates two transactions, via an ephemeral transparent address. finity preserves the TEX address and never converts it.
- Deposits need 100 Zcash confirmations, about 125 minutes, in each direction.
- Unit documents a 0.07 ZEC minimum. Smaller deposits are stuck, so the UI blocks them.
- Fees move, so the app reads them live and does not quote fixed prices.

## Market fit

**Demand signal.** Bitquery reported about $10B notional and roughly 29,600 ZEC perp trading accounts on Hyperliquid in August 2026. That sizes the existing ZEC perp market. It does not measure how many shielded holders would use this product, which needs direct customer evidence.

**Prior art.**

- ShieldTX: EVM USDC funding and separate position accounts.
- Zypher Trade: ZEC funding via NEAR swaps with service-executed trades.
- Zodl: already offers CrossPay and swaps.

finity's candidate distinction is user-controlled trading accounts, explicit recovery, and the full fund-trade-return workflow. This is a hypothesis pending a current competitor review.

**Revenue hypothesis.** A 0.05% Hyperliquid builder fee on attributed perp notional.

| Monthly attributed volume | Gross builder revenue |
| --- | --- |
| $1M | $500 |
| $10M | $5,000 |

These are arithmetic scenarios before partner shares, operations and support. Bridge turnover is not revenue.

**Distribution.** The most plausible channel is a Zcash wallet or community integration, such as a Zodl partnership. This is proposed, not agreed.

**Economics and fit constraints.**

- Bridge fees are meaningful at small sizes: about 0.0057 ZEC inbound, roughly 5.7% of a 0.1 ZEC deposit and 0.57% of 1 ZEC.
- A ~2 hour wait each way suits patient, larger-balance users and not impulsive traders.
- Users wanting confidential positions, instant funding, or EVM-free onboarding are not served by this version.

## Risks and dependencies

- **Unit** controls the backing ZEC through its guardian network.
- **Hyperliquid** liquidity in the Unit ZEC spot pair limits conversion size.
- **Key design.** A sign-to-derive scheme would make a signature a master secret. It needs review before holding real funds, with a dedicated EVM account as the fallback.
- **Browser trust.** Browser-only storage does not defend against malicious site code, compromised dependencies, or extensions.

## Roadmap

1. Public mainnet readiness: reviewed key and recovery design and bounded funding.
2. Better wallet experience: confirmed wallet capabilities and partnerships.
3. Route comparison: Unit against Zodl CrossPay and NEAR routes.
4. Privacy improvements with defined adversaries and measurable linkage tests.
5. Distribution through a real wallet or community channel.
