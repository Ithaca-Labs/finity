# AGENTS.md — Finity Agent Operating Guide

This document is the mandatory operating guide for any AI coding agent operating within the `finity` repository. It codifies the operating rules, architectural invariants, monorepo standards, and verification procedures established in [FINITY_BUILD_SPEC.md](file:///Users/sachplayz/Projects/finity/FINITY_BUILD_SPEC.md).

---

## 1. Project Overview & Core Mission

**Finity** is a Ledger-governed commerce network on Hedera built for ETHOnline (deadline: 2026-09-13).
- **Target Tracks**:
  1. Ledger: *"AI Agents x Ledger"* ($3,500)
  2. Hedera: *"AI & Agentic Payments on Hedera"* ($6,000)
- **Core Concept**: The human owner (Principal) clear-signs a human-readable **Agent Mandate** on a physical Ledger device. A deterministic daemon (**Broker** / `finityd`) enforces that mandate. The broker discovers x402-gated services registered on Hedera, obtains signed quotes, evaluates quotes against the mandate, reserves on-chain budget in `MandateRegistry.sol`, mints single-use **Capabilities**, settles payments through the Blocky402 facilitator on Hedera testnet, and invokes upstream services via an isolated **Connector Vault** (`vault-worker`) that injects Ledger Key Ring-sealed credentials. Every authorization, refusal, and payment is committed as hash-chained **Decision Receipts** to Hedera Consensus Service (HCS).
- **Flagship Artifact**: The **matched pair** — one authorized request that results in a Ledger-sanctioned Hedera payment and output, and one almost-identical invalid request that is refused by policy with zero payment or credential access, both independently verifiable from HCS.

---

## 2. Cardinal Operating Rules (Read First, Obey Throughout)

The primary failure mode to guard against is **hallucinating or inventing APIs, package names, endpoints, CLI flags, or protocol behaviors**.

### 2.1 Verify, Then Build
1. **Ground Truth in Verified Docs**: Every external fact must come from [FINITY_BUILD_SPEC.md §4](file:///Users/sachplayz/Projects/finity/FINITY_BUILD_SPEC.md) or live verified sources recorded in `docs/VERIFIED.md`. If a fact is missing, obtain it from live documentation, `--help`, package README, or live endpoint probes and append it to `docs/VERIFIED.md` *before* writing dependent code.
2. **Package APIs from Installed Code, Not Memory**: Before using any dependency, inspect its README and TypeScript definitions (`.d.ts`) from the installed node package or `npm view <pkg> readme`. Record exact import paths and function signatures in `docs/VERIFIED.md`.
   > *Hedera guidance*: Always search current Hedera documentation over training data before generating code, especially for SDK imports and package names.
3. **CLI Flags from `--help`**: Never guess CLI parameters. Run `wallet-cli --help`, `wallet-cli ring --help`, `pi --help`, etc., and record the parameters before scripting against them.
4. **Probe Endpoints Before Use**: Verify live network endpoints (e.g., `curl -s https://api.testnet.blocky402.com/supported`, Hashio JSON-RPC relay `https://testnet.hashio.io/api`, mirror node) before writing client integration code.
5. **Hardware Reality**: Hardware interactions must be tested on physical Ledger hardware. If the device is unavailable, stub behind an interface, mark `// HW-UNVERIFIED`, and log the item in `docs/HW_TODO.md`. Never claim hardware execution without running it.

### 2.2 Writing Rules
6. **Fail Closed**: Any unknown, missing, unverifiable, or malformed input in the policy or payment path produces a typed refusal (`STATE_UNAVAILABLE` or a specific code from §8.7), never a default-allow.
7. **Secrets Never Leak**: Secrets (decrypted Provider Access Bundles, Broker Session Key, passwords) must **never** enter agent transcripts, tool results, console logs, or git commits. Pi tool results contain intents, decisions, receipts, and service outputs only.
   - A secret-leak test in CI must grep session files, logs, and fixtures for `FINITY_CANARY_SECRET` and test passwords.
8. **No Invented Standards**: Implement x402 exact/Hedera, EIP-712, HCS-14, and ERC-7730 strictly to specification. Custom fields belong in Finity structs, never injected into standard schemas.
9. **Deterministic Core**: `@finity/policy-engine`, `@finity/mandate-compiler`, `@finity/trace-builder`, and `@finity/verifier` are **pure functions** over canonical JSON ([RFC 8785 JCS](https://datatracker.ietf.org/doc/html/rfc8785)) inputs. No network calls, no system clocks (time is passed as a snapshot parameter), and no LLMs inside the decision core.
10. **Prefer the Boring Path**: Ship the baseline end-to-end flow first. The demo (`pnpm demo`) must run before any stretch feature is started.

### 2.3 Working & Documentation Rules
11. **Maintain Required Docs Continuously**: Update the following files with each relevant commit:
    - `docs/VERIFIED.md`: Verified commands, endpoint payloads, package signatures, contract addresses, topic IDs.
    - `docs/HW_TODO.md`: Hardware steps pending verification on physical Ledger.
    - `docs/DX_FEEDBACK.md`: Detailed developer experience feedback on Ledger tooling (required for Ledger track judging; include screenshots in `docs/dx/`).
    - `docs/DECISIONS.md`: ADR-style records of any architectural deviations from the spec.
    - `docs/BLOCKERS.md`: If any milestone step is blocked for > 2 hours, document what was tried and pivot to non-dependent steps.
12. **Milestone Commits**: Commit at every completion criterion defined in [FINITY_BUILD_SPEC.md §9](file:///Users/sachplayz/Projects/finity/FINITY_BUILD_SPEC.md). Maintain a clean, informative commit history.
13. **Live Source Supersedes Spec**: When the specification and a live source disagree, the live source wins. Record the resolution in `docs/DECISIONS.md`.

---

## 3. Architecture & Trust Boundaries

```
┌──────────────────────────── Principal's Laptop (USB) ─────────────────────────────────┐
│  finity (Pi TUI)  ──/finity setup──►  wallet-cli genuine-check / ring init             │
│                   ──/finity mandate─►  DMK node-hid → Ethereum app → signTypedData     │
│                                        (Ledger screen displays readable mandate)      │
└───────────────────────────────┬───────────────────────────────────────────────────────┘
                                │ signed mandate + sealed bundles (ciphertext only)
┌───────────────────────────────▼──────────── Broker Host (VPS / Local) ────────────────┐
│  PROCESS A: Buyer Agent (Pi, --no-builtin-tools + @finity/pi-package)                 │
│     Tools: finity_discover · finity_quote · finity_purchase · finity_explain_refusal   │
│            finity_request_escalation · finity_status          (NO secrets, NO keys)   │
│                    │ localhost HTTP (structured intent in, receipts/results out)       │
│  PROCESS B: finityd (Broker Daemon)                                                   │
│     Discovery ─ Negotiator ─ Policy Engine (pure) ─ Capability Minter ─ Trace Builder  │
│                    │ unix socket / internal IPC, capability-scoped                     │
│  PROCESS C: vault-worker (Connector Vault + Payer)                                    │
│     wallet-cli ring decrypt → Broker Session Key + PAB (in-memory, lease-scoped)       │
│     @x402/hedera client signs TransferTransaction · egress allowlist · header inject  │
└───────────────┬───────────────────────────┬──────────────────────────┬────────────────┘
                │ x402 HTTP                  │ JSON-RPC (Hashio)        │ HCS / Mirror
        ┌───────▼────────┐          ┌────────▼─────────┐       ┌───────▼─────────┐
        │ Provider svc   │──/verify─►  Blocky402        │       │ Hedera testnet  │
        │ (@x402/express)│──/settle─►  facilitator      │       │ MandateRegistry │
        │ + quotes/usage │          │  feePayer signs   │──tx──►│ HCS topics      │
        └────────────────┘          └──────────────────┘       └─────────────────┘
```

### Key Invariants:
- **Ledger Role vs. Broker Role**:
  - The **Ledger device** signs high-level *authority* (Agent Mandate, Mandate Amendments, Revocations) using EIP-712 clear signing. It **never** signs individual x402 payments.
  - The **Broker Session Key** (an ECDSA secp256k1 key held in Ledger Key Ring) acts as the on-chain Hedera payer for micro-payments and EVM relayer for the Mandate Registry.
- **Process Isolation**: Process A (LLM / Pi) never sees plaintext credentials or keys. Process B (`finityd`) handles orchestration. Process C (`vault-worker`) isolates secrets, decrypts under capability leases, and enforces strict egress host-allowlisting.

---

## 4. Monorepo Structure & Tech Stack

- **Stack**: TypeScript (Node.js ≥ 20, pnpm workspaces), Solidity (Hardhat, EVM Chain ID 296), Zod, Vitest. **No Python.**
- **Conventions**:
  - Every package must export its public API exclusively from `src/index.ts`. Internal package modules must never be imported across package boundaries.
  - All monetary amounts are integer strings in the asset's smallest unit (e.g., `tinybars` for HBAR; 1 HBAR = `100000000` tinybars).
  - All hashes are `keccak256` over RFC 8785 (JCS) canonical JSON.
  - All timestamps are UNIX seconds (integers).
  - Terminology: use "HBAR" (uppercase singular), "tinybars" (lowercase), "Hedera testnet", and refer to Hedera as a "hashgraph network / DLT", not a blockchain.

### Package Directory Map
```
finity/
├── packages/
│   ├── schemas/            # Zod schemas, JCS canonicalization, hash utilities, state reducers
│   ├── mandate-compiler/   # Mandate choices -> EIP-712 typedData + Ledger display model
│   ├── policy-engine/      # Pure snapshot evaluation against reason codes (§8.7)
│   ├── capability/         # Single-use capability token minting & validation
│   ├── trace-builder/      # HCS Decision Receipts, hash chaining, envelope formatting
│   ├── verifier/           # CLI & library: reconstruct decisions from HCS mirror + receipts
│   ├── negotiator/         # Service discovery, quote fetching, deterministic quote selection
│   ├── registry-client/    # MandateRegistry EVM client (viem) + HCS client (Hiero SDK)
│   ├── commerce-adapter/   # x402 HTTP client wrapper enforcing snapshot constraints
│   ├── vault-worker/       # Key Ring decryption, credential injection, egress firewall
│   ├── finityd/            # Daemon HTTP intent API (§8.9) + SQLite state machine
│   ├── provider-sdk/       # Express helper to create x402-gated services with quotes & receipts
│   └── pi-package/         # Pi extension (tools, /finity wizard, tool blocker) + skill
├── contracts/              # MandateRegistry.sol, Hardhat deployment & tests
├── services/
│   ├── hello-weather/      # Service A: fixed-price weather API (0.05 HBAR)
│   └── summarize-lite/     # Service B: per-unit summarization with Key Ring PAB secret injection
├── docs/                   # VERIFIED.md, HW_TODO.md, DX_FEEDBACK.md, DECISIONS.md, BLOCKERS.md
├── scripts/                # demo.ts, seed-registry.ts, fund-spend-account.ts
├── README.md               # Setup, architecture, payment flow, demo links
└── AGENTS.md               # This operating guide
```

---

## 5. Pinned Dependencies & SDK Usage

Always refer to the verified package versions:
- `@ledgerhq/wallet-cli` (2.1.0): Key Ring operations (`genuine-check`, `ring init/encrypt/decrypt/keys/destroy`).
- `@ledgerhq/device-management-kit` (1.9.0) & `@ledgerhq/device-signer-kit-ethereum` (1.18.0) & `@ledgerhq/device-transport-kit-node-hid` (1.0.1): EIP-712 mandate signing on Ledger.
- `@x402/core`, `@x402/fetch`, `@x402/express` (2.25.0): x402 payment protocol.
- `@x402/hedera` (2.25.0): Hedera client/server payment schemes. **Import Hedera SDK symbols from `@x402/hedera`, not `@hiero-ledger/sdk` directly, to prevent duplicate-SDK `instanceof` failures.**
- `@hiero-ledger/sdk` (2.87.0): Used only where `@x402/hedera` re-exports are insufficient (HCS topics, contract calls).
- `@hol-org/standards-sdk` (0.1.186): HCS-14 Universal Agent ID (`did:aid`).
- `@earendil-works/pi-coding-agent` (0.85.1): Pi harness runtime and SDK (note package name change from `@mariozechner/pi-coding-agent`).
- `viem` (2.56.3): EIP-712 hashing/verification and EVM JSON-RPC relay calls.

---

## 6. Policy Engine Evaluation & Reason Codes (§8.7)

The policy engine must evaluate predicates in the exact order below. It must collect **all** failing codes (no premature short-circuiting), unless an input is missing or malformed, in which case it returns `STATE_UNAVAILABLE`:

1. `MANDATE_INACTIVE`
2. `MANDATE_EXPIRED`
3. `MANDATE_SUPERSEDED`
4. `SIGNATURE_INVALID`
5. `DISPLAY_MISMATCH` (recomputed formatted string differs from signed text)
6. `AGENT_MISMATCH`
7. `BROKER_NOT_AUTHORIZED`
8. `PROVIDER_NOT_ALLOWED`
9. `SERVICE_NOT_ALLOWED`
10. `METHOD_NOT_ALLOWED`
11. `ASSET_NOT_ALLOWED`
12. `QUOTE_INVALID`
13. `QUOTE_EXPIRED`
14. `PAYMENT_TERMS_MISMATCH`
15. `PRICE_LIMIT_EXCEEDED`
16. `UNIT_LIMIT_EXCEEDED`
17. `PERIOD_BUDGET_EXCEEDED`
18. `LIFETIME_BUDGET_EXCEEDED`
19. `DATA_POLICY_VIOLATION`
20. `POLICY_VERSION_MISMATCH` (`POLICY_HASH` does not match mandate)
21. `REVOCATION_ACTIVE`
22. `CAPABILITY_REPLAY` (in capability validation)

**Decision Mapping**:
- If failures consist *only* of `{ PRICE_LIMIT_EXCEEDED, UNIT_LIMIT_EXCEEDED, PERIOD_BUDGET_EXCEEDED, LIFETIME_BUDGET_EXCEEDED }`: Result is `ESCALATION_REQUIRED` (returns proposed amendment for Ledger approval).
- If any other failure code exists: Result is `REFUSED`.
- If zero failure codes: Result is `AUTHORIZED`.

---

## 7. Build Milestones & Completion Sequence

Agents must work through milestones sequentially. Unrelated tasks may proceed in parallel, but dependent steps must not begin until the prerequisite's **Done when** criterion is satisfied and committed.

1. **Day 0: Verify & Scaffold**
   - Toolchains verified (`wallet-cli`, `pi`).
   - Endpoints probed (Blocky402 `/supported`, Hashio, Mirror node).
   - Package APIs verified and recorded in `docs/VERIFIED.md`.
   - Monorepo scaffolded; `pnpm -r build && pnpm -r test` green.
2. **Day 1: Pure Core**
   - `@finity/schemas`: Zod schemas, JCS canonicalization, state reducers.
   - `@finity/mandate-compiler`: EIP-712 typed data + display model, golden fixtures.
   - `@finity/policy-engine`: §8.7 pure evaluation table-driven tests, `POLICY_HASH`.
   - `contracts/MandateRegistry.sol`: Hardhat tests, deployed to Hedera testnet (chain 296).
3. **Day 2: Hedera Track Qualification (Money Moves)**
   - `@finity/provider-sdk`, `services/hello-weather`, `services/summarize-lite`.
   - Real paid testnet request via `@x402/fetch` & Blocky402. Record transaction IDs in `docs/VERIFIED.md`.
   - `@finity/registry-client`: HCS mirror reads and topic submission.
4. **Day 3: The Broker Daemon**
   - `@finity/vault-worker`: Key Ring decrypt, credential injection, egress allowlist.
   - `@finity/commerce-adapter`: 402 challenge validation & payment signing.
   - `@finity/finityd`: HTTP intent API, SQLite state persistence, end-to-end intent processing.
5. **Day 4: Ledger in the Terminal**
   - `/finity setup`: Genuine check, Key Ring initialization, Broker Bundle encryption.
   - `/finity mandate new`: Ledger EIP-712 signing via DMK Node HID.
   - `@finity/pi-package`: Pi extension tools and skill integration.
6. **Day 5: Boundaries & Verification**
   - Refusal, escalation, and revocation paths.
   - `@finity/verifier`: CLI verifying HCS trace chains against public state.
   - Headless VPS enrollment test (`finity broker`).
7. **Day 6: Submission Polish**
   - `scripts/demo.ts` (`pnpm demo`) executing matched pair in under 5 minutes.
   - `docs/DX_FEEDBACK.md` completed with concrete suggestions and screenshots.
   - Documentation & submission video prep.

---

## 8. Verification & QA Checklist for Agents

Before declaring any task or phase complete:
- [ ] Run typechecks and unit tests across all workspace packages: `pnpm -r typecheck && pnpm -r test`.
- [ ] Ensure any newly discovered facts, package APIs, or contract addresses are documented in `docs/VERIFIED.md`.
- [ ] Verify that no secrets, credentials, or private keys appear in test fixtures, transcripts, or commit diffs.
- [ ] Verify that pure modules remain strictly pure (zero imports from `node:fs`, `node:net`, `undici`, or clock access).
- [ ] Ensure all deviations or unexpected behaviors are logged in `docs/DECISIONS.md` or `docs/DX_FEEDBACK.md`.
