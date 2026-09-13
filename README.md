<p align="center">
  <img src="apps/console/public/finityclick.png" alt="Finity" width="480" />
</p>

# Finity

> **The Ledger signs the rules. The broker enforces them. Every decision lands on Hedera.**

Finity is a Ledger-governed commerce network on Hedera testnet. A human principal
clear-signs a human-readable **Agent Mandate** on a physical Ledger device. A
deterministic broker daemon (`finityd`) then lets an AI buyer agent discover
x402-gated services, obtain signed quotes, and pay in HBAR — but only inside the
exact limits the human signed. The agent never holds keys. The Ledger never signs
payments. Every authorization, refusal, and payment is committed as a
hash-chained **Decision Receipt** to Hedera Consensus Service (HCS).

Built for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026).

## The problem

AI agents that can pay for things need keys, and keys in an agent runtime are one
prompt injection away from a drained wallet. The alternatives today are bad:
give the model a hot wallet (unbounded trust), or require a human click per
payment (not agentic at all).

## The Finity split

Finity separates **authority** from **spending**:

- **The Ledger device** signs high-level authority only — the Agent Mandate,
  amendments, and revocations — as EIP-712 clear-signed typed data. It never
  signs individual x402 payments.
- **A Broker Session Key** (sealed in the Ledger Key Ring, decrypted only inside
  an isolated `vault-worker` process under a single-use capability lease) pays
  HBAR micro-payments on Hedera — but only after a pure, deterministic policy
  engine re-verifies the request against the signed mandate.
- **The LLM** (Pi buyer agent) expresses intent through structured tools. It
  never sees credentials, quotes are provider-signed, and anything outside the
  mandate returns a typed refusal or a Ledger-gated escalation — never a
  default-allow.

## The matched pair

The flagship artifact is a **matched pair** of near-identical requests, both
independently verifiable from HCS:

| Request | Result | On-chain evidence |
|---|---|---|
| `weather.current:London` under an active mandate | `AUTHORIZED` → 0.05 HBAR paid → `RECONCILED` | HCS DECISION → PAYMENT → USAGE → RECONCILED chain + public settlement transaction |
| Same city, `dataClass=1` the mandate forbids | `REFUSED` — `DATA_POLICY_VIOLATION` | HCS refusal receipt; **zero** reservation, zero payment, zero credential access |

Verified live on 2026-09-13: authorized purchase `f66ffcb2-2764-482d-861f-f51d69266ed3`
reached `RECONCILED` (London, GB, drizzle, 19°C via Open-Meteo); the matched
refusal `f6447ab7-338c-4870-91a7-84691cd3c94d` stopped before reservation.

## Architecture

```
┌──────────────────── Principal's laptop (USB) ────────────────────┐
│  Pi TUI ── /finity setup ──► wallet-cli genuine-check, ring init │
│         ── /finity mandate ─► DMK → Ethereum app → signTypedData │
│                  (Ledger screen shows the readable mandate)      │
└──────────────────────────────┬───────────────────────────────────┘
                               │ signed mandate + sealed bundles (ciphertext only)
┌──────────────────────────────▼────────── Broker host ────────────┐
│  A: Buyer agent (Pi, --no-builtin-tools + @finity/pi-package)    │
│     finity_* tools only — no secrets, no keys                    │
│  B: finityd — discover → quote → policy → capability → trace     │
│  C: vault-worker — Key Ring decrypt, x402 Hedera signer,         │
│     egress allowlist, credential injection under lease           │
└──────┬───────────────────────┬──────────────────────┬────────────┘
       │ x402 HTTP             │ JSON-RPC (Hashio)    │ HCS / mirror
┌──────▼────────┐     ┌────────▼─────────┐   ┌────────▼─────────────┐
│ Provider svcs │────►│ Blocky402        │   │ Hedera testnet       │
│ (@x402/express│     │ facilitator      │──►│ MandateRegistry.sol  │
│  + quotes)    │     │ hedera:testnet   │   │ HCS topics           │
└───────────────┘     └──────────────────┘   └──────────────────────┘
```

## How a purchase works

1. **Mandate** — the principal picks services, methods, per-request / per-period
   / lifetime caps, validity window, data-class ceiling, and an escalation rule.
   The mandate compiler renders each limit as human-readable text embedded in
   the EIP-712 message, and the Ledger clear-signs exactly that text.
2. **Register** — `finityd` relays the signed mandate to `MandateRegistry.sol`
   on Hedera testnet (EVM chain 296), which recovers the principal, binds the
   broker and spend account, and assigns the mandate's HCS trace topic.
3. **Discover** — the negotiator reads signed service manifests from a public
   HCS registry topic (`@hol-org/standards-sdk` HCS-14 agent IDs).
4. **Quote** — the provider signs a priced quote (asset, units, expiry, nonce).
5. **Evaluate** — the pure `@finity/policy-engine` checks 22 reason codes in a
   fixed order against a snapshot (time is an input, never a clock). Output is
   `AUTHORIZED`, `REFUSED`, or `ESCALATION_REQUIRED` with a proposed amendment.
6. **Reserve** — on-chain budget reservation in `MandateRegistry` before any
   payment; released automatically on failure or timeout.
7. **Pay** — the vault-worker mints a single-use capability, signs the x402
   `exact` Hedera payment, and the Blocky402 facilitator settles on testnet.
8. **Receipt** — DECISION, PAYMENT, USAGE, and RECONCILED envelopes are
   hash-chained to the mandate's HCS topic. `@finity/verifier` reconstructs the
   whole decision from the mirror node alone.

## What the Ledger clear-signs

The mandate is EIP-712 typed data rendered on the device as readable fields —
no raw hex. The signed `*Text` fields are re-verified by the policy engine
(`DISPLAY_MISMATCH` refuses a mandate whose numbers don't match its text):

| Device field | Example |
|---|---|
| Agent | `pi-buyer-agent` |
| Services | `hello-weather@1, summarize-lite@1` |
| Methods | `weather.current, summarize.text` |
| Asset | `HBAR` |
| Max per request | `0.05 HBAR` |
| Max per period | `0.50 HBAR per 1h` |
| Lifetime cap | `1.00 HBAR total` |
| Valid until | `2026-09-13 18:00 UTC` |
| Escalation rule | `ESCALATE` |

Amendments (escalations) and revocations are clear-signed the same way.

## Prize tracks

| Track | Requirement | How Finity qualifies |
|---|---|---|
| **Ledger — AI Agents x Ledger** | AI agent operating under hardware-signed authority | The agent's entire authority is a Ledger clear-signed EIP-712 mandate enforced by a deterministic broker; amendments and revocations are also device-signed. Agent tool surface contains no keys or secrets. |
| **Hedera — AI & Agentic Payments** | AI agent making real payments on Hedera | Real x402 `exact`/`hedera:testnet` HBAR payments via the Blocky402 facilitator, an on-chain `MandateRegistry` reserving budget, service discovery and decision receipts on HCS, HCS-14 agent identity. |

## Live Hedera testnet evidence

All public identifiers; every value below is recorded in `docs/VERIFIED.md`.

| Artifact | Value |
|---|---|
| `MandateRegistry` contract | `0.0.10423109` / EVM `0xcbc39351ca205fd291b73d0c31904590c3098d89` |
| Service registry HCS topic | `0.0.10423110` |
| Mandate trace HCS topic | `0.0.10423252` |
| Broker spend account | `0.0.10423102` |
| Provider accounts | `0.0.10423105`, `0.0.10423106` |
| x402 settlement tx (0.05 HBAR) | `0.0.7162784-1788898976-660100298` |
| Ledger-signed revocation (EVM tx) | `0x6100b95d5275d75d43f0c9e6a8ae4510d8fef22d82e136a11ae4bcef9248d3c9` |
| Revocation HCS envelope | `0.0.8260226@1789294394.678990016` |

Verify any of it on [Hashscan testnet](https://hashscan.io/testnet) or via the
mirror node (`https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10423252/messages`).

## Run it

Prerequisites: Node.js ≥ 20, pnpm 10, and — for the Ledger path —
`@ledgerhq/wallet-cli` and a physical Ledger with the Ethereum app.

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

### Judge walkthrough — the matched pair

```bash
# Terminal 1: build + start both providers and finityd locally
pnpm install --frozen-lockfile
FINITY_PROVIDER_A_PUBLISHED_AT=1789291700 FINITY_PROVIDER_B_PUBLISHED_AT=1789291700 pnpm dev:stack

# Terminal 2: authorized purchase — discovers the HCS-published service,
# gets a signed quote, evaluates policy, reserves budget, settles a real
# x402 HBAR payment, fetches live Open-Meteo data, waits for RECONCILED
FINITY_TESTNET=1 pnpm e2e:weather -- --city London

# The matched refusal — same path, refused before reservation or payment
FINITY_TESTNET=1 pnpm e2e:weather -- --city London --data-class 1
```

The timestamp overrides match the currently published testnet manifests. For a
new registry topic, set stable provider timestamps in `.env` before running
`pnpm registry:seed`, then omit these overrides. `dev:stack` reuses healthy
processes and only stops what it started. Both testnet commands fail closed
unless `FINITY_TESTNET=1` is set deliberately.

### The buyer agent

```bash
npm i -g @ledgerhq/wallet-cli @earendil-works/pi-coding-agent
pnpm --filter finity --filter @finity/pi-package --filter @finity/finityd build
pnpm agent
```

Ask Pi to buy weather for a city. `finity_buy` reuses a sealed broker and an
ACTIVE compatible mandate when present; otherwise the same chat flow Key-Ring-
seals a broker key, asks the Ledger to fund it, resolves the Hedera account ID
from the mirror node, clear-signs a mandate on the device, starts `finityd`,
and resumes the purchase — no setup prompts for existing users.

`/finity` opens the control center: live mandate status, period/lifetime budget
remaining, broker balance, pending escalations, Hedera connectivity, kill
switch, revoke, and withdraw back to the principal. `/finity revoke`
clear-signs a Revocation on the device; `finityd` relays only that signed
authorization, confirms `REVOKED` on-chain, then clears the local pointer.

On macOS the wrapper loads `WALLET_PASS` from Keychain service
`ledger-wallet-cli`, account `default`; it never enters the chat. Setup reuses
an initialized Key Ring and a valid existing broker bundle — rerunning it never
creates a second broker or requests another funding payment. Fresh setup
derives funding from the mandate draft's lifetime cap plus a fee reserve;
`FINITY_SETUP_FUNDING_TINYBAR` overrides it intentionally.

### Provider processes

The two providers need their own Hedera account IDs, public HTTPS origins, and
provider-owned ECDSA signing keys via `.env` (never the Broker Session Key):

```bash
pnpm provider:weather     # hello-weather — 0.05 HBAR/call, live Open-Meteo data
pnpm provider:summarize   # summarize-lite — 0.01 HBAR per 1,000-char unit
```

### Web console

```bash
pnpm --filter @finity/console dev     # landing page + /docs guide
```

`pnpm --filter @finity/console build && pnpm --filter @finity/console start`
for production; the build also emits `apps/console/public/downloads/finity-0.1.0.tar.gz`.

## Tech stack

| Layer | Technology |
|---|---|
| Agent runtime | `@earendil-works/pi-coding-agent` 0.85.1 (`--no-builtin-tools` + Finity extension) |
| Ledger | DMK 1.9.0, `device-signer-kit-ethereum` 1.18.0, `node-hid` transport, `wallet-cli` 2.1.0 Key Ring |
| Payments | `@x402/core` / `fetch` / `express` / `hedera` 2.25.0, `exact` scheme on `hedera:testnet` |
| Facilitator | Blocky402 testnet (fee payer `0.0.7162784`) |
| Chain | Hedera testnet, EVM chain 296 via Hashio, mirror node REST |
| Contract | `MandateRegistry.sol` (Solidity 0.8.24, Hardhat 3) |
| Identity/audit | `@hol-org/standards-sdk` HCS-14, hash-chained HCS Decision Receipts |
| Core | TypeScript, Zod, RFC 8785 JCS, keccak256, pure deterministic packages |

## Repository layout

```
packages/    schemas · mandate-compiler · policy-engine · capability
             trace-builder · verifier · negotiator · registry-client
             commerce-adapter · vault-worker · finityd · provider-sdk
             pi-package · finity-cli
contracts/   MandateRegistry.sol + Hardhat tests
services/    hello-weather (0.05 HBAR/call) · summarize-lite (0.01 HBAR/1k chars)
apps/        console — landing page, /docs guide, source archive
scripts/     demo, e2e-weather, registry seed, testnet bootstrap, local stack
docs/        VERIFIED.md · HW_TODO.md · DX_FEEDBACK.md · DECISIONS.md · BLOCKERS.md
```

## Verification status

The mandate used for the recorded runs above was later revoked on a physical
Ledger (evidence in the table); judges run their own fresh mandate through the
same path. Remaining hardware-pending items — a second full physical mandate
registration round-trip, device-photo evidence, and a live `finity-verify`
run — are tracked honestly in `docs/HW_TODO.md`. Ledger tooling DX feedback
collected for track judging lives in `docs/DX_FEEDBACK.md`. No claim in this
README is made without a corresponding entry in `docs/VERIFIED.md`.
