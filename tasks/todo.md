# Todo

## 2026-09-09 first-purchase interactive onboarding

### Plan

- [x] Checkpoint the already-verified runtime and payment fixes in focused commits.
- [x] Add one resumable onboarding module behind `ensureReadyForPurchase`.
- [x] Reuse a healthy existing broker bundle, spend account, active mandate, and daemon instead of reprovisioning.
- [x] Persist pending onboarding state without persisting plaintext broker keys.
- [x] Generate and Key-Ring-seal a fresh broker key before funding when no reusable broker exists.
- [x] Add Ledger Ethereum address verification and Hedera EVM funding transaction signing/broadcast.
- [x] Resolve the funded broker alias to its Hedera account ID and finalize the sealed bundle.
- [x] Build a narrow mandate interactively from the requested service and quote, sign/register it, and activate it.
- [x] Start or reconnect to `finityd`, then resume the original purchase automatically.
- [x] Add tests for existing-state reuse, fresh setup, cancellation, restart/resume, and secret isolation.
- [x] Update verified APIs, decisions, hardware TODOs, and user documentation.
- [x] Commit implementation milestones and merge the completed branch into `main`.

### Verification

- [x] Pi package build, typecheck, and tests pass.
- [x] Full workspace build, typecheck, and tests pass.
- [x] Secret-pattern and diff checks pass.
- [x] Existing active setup reaches purchase without Ledger or Key Ring reprovisioning.
- [x] Fresh setup pauses only for explicit UI/device approvals and resumes the original intent (automated; physical funding remains HW-unverified).

### Review

#### Changed

- Added `finity_buy` as the single chat-first purchase interface.
- Added reuse-first broker/mandate validation against local signed state and live registry status.
- Added resumable Key Ring sealing, Ledger EVM funding, alias resolution, narrow mandate signing, broker-owned registration, daemon startup, and purchase continuation.
- Added x402 settlement transaction capture and Mirror Node `chunk_info.total=1` support.

#### Verified

- Full workspace build, typecheck, and tests pass.
- Existing broker and mandate reused with no prompt; live Kolkata purchase reached `RECONCILED`.
- Registry remains ACTIVE with zero reserved balance; HCS sequences 17-20 contain the complete trace.
- Diff and credential-pattern checks pass.

#### Risks

- Physical Ledger funding and mandate signing require the user/device and cannot be claimed from unit tests.
- The currently running daemon predates settlement-header capture; restart it before the next live purchase to include the transaction ID in the PAYMENT envelope.

#### Follow-ups

## 2026-09-09 Ledger-account funding flow

### Plan

- [x] Confirm the Ledger EIP-712 signer EVM alias as the requested destination.
- [x] Verify source balance, destination alias, and testnet before transfer.
- [x] Transfer 50 HBAR from operator `0.0.8260226` to the confirmed alias.
- [x] Verify the transaction and resulting hollow account on Mirror Node.
- [x] Define the user flow from Ledger funding through mandate activation and purchases.

### Verification

- [x] Confirm transaction status is `SUCCESS` and recipient received exactly 50 HBAR.
- [x] Confirm no mainnet account or unrelated account was touched.

### Review

#### Changed

- Funded the Ledger EVM principal alias with 50 testnet HBAR.
- Recorded the auto-created account and transaction evidence.

#### Verified

- Alias `0xeAceF641...d828b0` resolved to new account `0.0.10427444` with a 50 HBAR balance.
- Transaction `0.0.8260226-1788900863-017047227` is `SUCCESS` on Hedera testnet.

#### Risks

- The account is hollow (`key: null`) until its first outbound transaction is signed by the matching Ledger Ethereum key.
- The existing spend account is already funded; a clean user-funded demo should use a fresh empty spend account or first reconcile the old test funds.

#### Follow-ups

- Complete the hollow account with a Ledger-signed outbound EVM transaction.
- Implement the principal-to-spend-account funding step in setup UX.

## 2026-09-08 user-requested deployment/test audit

### Plan

- [x] Verify the persisted Ledger mandate against the live Hedera registry and HCS topic.
- [x] Verify local Key Ring readiness, daemon prerequisites, and provider reachability without exposing secrets.
- [x] Run build, typecheck, and full test suite.
- [x] Run one safe end-to-end smoke test or document the exact external blocker.
- [x] Record findings, changed files, verification, risks, and follow-ups.

### Verification

- [x] Live mandate record is active and signature principal matches.
- [x] `finityd` health and provider endpoints are reachable, or blocker is recorded.

### Review

#### Changed

- Added post-signing registration progress notifications.
- Added repo-local `.env` loading to the `finity` wrapper.
- Added an explicit `WALLET_PASS` startup error for `finityd`.
- Fixed Key Ring bundle decryption to consume wallet-cli plaintext stdout.
- Stabilized provider manifest `publishedAt` so quote hashes remain HCS-bound.
- Made direct provider launchers load repo-local `.env` automatically.
- Pointed the Pi package manifest at the runnable extension file instead of its declaration-containing directory.
- Fixed registry receipt decoding for successful `ReservationCreated` transactions.
- Enabled x402 facilitator initialization before protected provider routes.
- Added x402 v2 `PAYMENT-REQUIRED` header parsing with legacy fallback.
- Allowed only the quote's exact HBAR asset/network/amount through x402 spend controls.

#### Verified

- Live mandate is active on Hedera testnet; EIP-712 signature recovers the on-chain principal.
- Local provider health and quote endpoints respond successfully.
- `pnpm build`, `pnpm typecheck`, and `pnpm test` pass after the changes.
- Broker loaded the live mandate; the first live purchase safely refused before payment with `QUOTE_INVALID`.
- `pnpm provider:weather` now starts successfully from the repo with `.env` loaded; provider-runtime tests and typecheck pass.
- Pi package build and tests pass; package extension loading no longer selects `finity.d.ts`.
- Registry client test/build pass; the stranded 5,000,000-tinybar reservation was released and on-chain `reserved` is back to `0`.
- Fresh provider smoke test returns HTTP 402 with Hedera fee-payer requirements; failed-payment cleanup leaves consumption at `0`.
- Final broker-mediated weather purchase reached `RECONCILED`; Hedera settlement and HCS trace evidence verified.

#### Risks

- Local Hedera testnet purchase is verified; public HTTPS provider deployment is still pending.
- Earlier failed/refused attempts remain in the HCS trace alongside the successful matched receipt chain.
- Live credentials remain exposed and require rotation before treating this setup as secure.

#### Follow-ups

- Deploy both provider services publicly and rerun the guarded paid test.
- Rotate the exposed operator, broker, and provider signing credentials, then republish manifests and register a new mandate.

## Plan

- [x] Hardware E2E run: fast-forward `main` and record the pulled commit.
- [x] Hardware E2E run: inspect current environment without printing secrets.
- [x] Hardware E2E run: verify installed Node, pnpm, wallet-cli, and Pi versions.
- [x] Hardware E2E run: verify wallet-cli session state and command help.
- [ ] Hardware E2E run: verify the Ethereum app and USB readiness for mandate signing.
- [x] Hardware E2E run: run Ledger genuine-check sequentially.
- [x] Hardware E2E run: verify or initialize the Ledger Key Ring using user-provisioned credentials only.
- [ ] Hardware E2E run: verify Broker Bundle recovery without exposing plaintext.
- [x] Hardware E2E run: build and typecheck the pulled tree.
- [x] Hardware E2E run: run the complete unit and integration test suite.
- [x] Hardware E2E run: bootstrap separate Hedera testnet broker/provider accounts and persist only non-secret config.
- [x] Hardware E2E run: deploy `MandateRegistry` to Hedera testnet and create the HCS service registry topic.
- [ ] Hardware E2E run: start the local broker and verify health.
- [ ] Hardware E2E run: exercise the Pi extension doctor path.
- [ ] Hardware E2E run: prepare a real mandate draft from the repository fixture.
- [ ] Hardware E2E run: sign the mandate on the physical Ledger.
- [ ] Hardware E2E run: register the signed mandate against the configured Hedera registry.
- [ ] Hardware E2E run: verify the registered mandate and trace topic.
- [x] Hardware E2E run: verify provider and facilitator availability.
- [ ] Hardware E2E run: run the authorized paid HBAR purchase.
- [ ] Hardware E2E run: run the matched policy refusal and confirm zero settlement.
- [ ] Hardware E2E run: run the verifier against the resulting receipt and public evidence.
- [ ] Hardware E2E run: record exact evidence, blockers, and any hardware result.

- [x] 1. Verify Node, pnpm, wallet-cli, Pi, and required Ledger skills.
- [x] 2. Probe Blocky402 `/supported`, Hedera mirror, and Hashio chain ID.
- [x] 3. Verify package APIs from installed READMEs and type definitions.
- [x] 4. Resolve CLI, Key Ring enrollment, node-hid, HCS-14, and x402 verification items (HCS-14 packaging resolved by depending on `@hashgraphonline/standards-sdk` directly, see ADR-005 update; enrollment/genuine-check/ring-init themselves remain `HW-UNVERIFIED`).
- [x] 5. Scaffold the pnpm TypeScript monorepo, package scripts, CI, and environment template.
- [x] 6. Implement `@finity/schemas`: canonical JSON, hashes, schemas, and state reducers.
- [x] 7. Implement `@finity/mandate-compiler`: EIP-712 data and Ledger display model.
- [x] 8. Implement `@finity/policy-engine`: ordered fail-closed evaluation and policy hash.
- [x] 9. Implement and test `MandateRegistry.sol` locally; prepare testnet deployment.
- [x] 10. Implement `@finity/provider-sdk`, runnable x402 provider entry points, signed-manifest publishing, and the gated paid-request client.
- [x] 11. Implement `@finity/registry-client` for mirror, HCS, and Hashio access, including canonical service-manifest submission.
- [x] 12. Implement `@finity/vault-worker` with Key Ring isolation, egress, injection, and redaction.
- [x] 13. Implement `@finity/commerce-adapter` with x402 challenge binding.
- [x] 14. Implement `@finity/negotiator`, `@finity/capability`, and `@finity/trace-builder`.
- [x] 15. Implement `@finity/finityd` HTTP API and reducer-backed SQLite orchestration.
- [x] 16. Add local end-to-end flow and gated Hedera testnet payment flow.
- [x] 17. Add Ledger setup and mandate-signing interfaces, marking hardware-unverified paths.
- [x] 18. Add `@finity/pi-package`, the buyer skill, tool blocker, and wrapper CLI.
- [x] 19. Add refusal, escalation, revocation, expiry, kill-switch, and recovery paths.
- [x] 20. Implement `@finity/verifier` and tamper/insufficient-disclosure checks.
- [ ] 21. Build `pnpm demo`, README architecture/payment docs, and judge-facing evidence.
- [ ] 22. Run full QA, secret-leak checks, review diffs, push/merge phase branches, and record risks.
- [x] 23. Reproduce and fix CI ordering for generated contract types; verify the remote checks.

## Day 2 status — code complete, live evidence pending

- [x] Provider SDK and both provider services build, typecheck, and test locally.
- [x] `pnpm provider:weather` and `pnpm provider:summarize` provide deployable x402 service entry points with signed runtime manifests.
- [x] `pnpm registry:seed` creates an HCS service-registry topic and publishes both canonical signed manifests, guarded by `FINITY_TESTNET=1`.
- [x] `pnpm testnet:paid` uses `@x402/fetch` with the Hedera exact scheme to make one paid request to each service, also guarded by `FINITY_TESTNET=1`.
- [x] `pnpm build`, `pnpm typecheck`, and `pnpm test` pass after the Day 2 changes.
- [ ] Deploy both services at public HTTPS origins; configure the required funded Hedera operator, provider, and Spend Account credentials locally.
- [ ] Run the two guarded testnet commands and record the registry topic plus both Blocky402 settlement transaction IDs and HashScan links in `docs/VERIFIED.md`.

The unchecked items are the Day 2 build-spec completion criterion. They cannot
be truthfully marked complete until funded testnet credentials and public
provider URLs are configured outside this repository.

## Day 3 status — code complete and locally proven; testnet evidence remains blocked on Day 2/4

- [x] Single-use capability minting/lease guard, canonical trace envelopes, and unit tests.
- [x] Vault request allowlist, redirect blocking, scoped credential injection, and redaction tests.
- [x] x402 challenge-to-quote binding before retry/signing and the mismatched-`payTo` adversarial test.
- [x] Localhost bearer-token API and reducer-backed SQLite purchase store implementation.
- [x] `@finity/negotiator`: `discover()` over the registry HCS topic, `quote()` against a provider’s quote endpoint, deterministic `select()`.
- [x] `@finity/trace-builder`: test coverage for the existing envelope/hash-chain functions, plus `buildDecisionReceipt` for the broker’s signed receipt.
- [x] Wire the existing registry/negotiator/provider clients into the injected `finityd` executor (`createIntentExecutor`): the full F4 state machine (discovery → quote → policy evaluation → on-chain reservation → capability-scoped payment → delivery → reconciliation) runs end to end against injected fakes, hash-chaining a DECISION/PAYMENT/USAGE/RECONCILED trace envelope after each step.
- [x] Local end-to-end flow: `packages/finityd/src/executor.test.ts` drives the pipeline to `RECONCILED` (and separately exercises refusal, escalation, discovery/quote failure, and payment failure) without a network, registry contract, or Ledger.
- [x] Gated Hedera testnet payment flow: `pnpm finityd intent --file fixtures/intent-weather.json` (`scripts/finityd-intent.ts`), refusing unless `FINITY_TESTNET=1`, mirroring Day 2’s `testnet:paid`. Not run — see below.
- [x] Run native `better-sqlite3` build approval (`pnpm-workspace.yaml`’s `onlyBuiltDependencies`), then test durable on-disk state across a real file reopen.
- [ ] Finish the exact Key Ring OS-keychain reader and run a hardware-gated decrypt test.
- [ ] Run `pnpm finityd` against deployed Day 2 services with a real, Ledger-signed, on-chain-registered mandate, and record the real HCS trace/payment evidence.

Two gaps surfaced by wiring the executor for real are intentionally left
open rather than papered over, and are called out inline in
`scripts/finityd-intent.ts`:

- `ServiceManifest` has no client-facing resource path for a paid method
  (only `quoteEndpoint`/`healthEndpoint`), so a buyer cannot derive the
  paid HTTP path from the manifest alone. The gated script hardcodes a
  path per known Day 2 service as a stand-in.
- Mandate/quote/manifest signature verification and on-chain principal
  recovery have no decided scheme anywhere in this codebase yet. The
  executor’s `SnapshotBuilder` is an injected seam for this reason: the
  gated script’s builder trusts every signature unconditionally, which is
  honest only because `@finity/verifier` (step 20) has not been built.

The remaining Day 3 item — real testnet evidence — cannot be truthfully
marked complete without a funded broker account, a deployed
`MandateRegistry`, the Day 2 services running at public HTTPS origins,
and a mandate actually registered on-chain with a real Ledger signature
(Day 4). Also unrelated to Day 3: this workspace’s test runners pick up
compiled `dist/*.test.js` alongside `src/*.test.ts` in every package
(no `vitest.config` excludes `dist`), silently doubling every test count
reported by `pnpm -r test`. Pre-existing since Day 1, not fixed here.

## Day 4 status — code complete and locally proven without hardware; every device-touching path is untested

No Ledger device, and neither `wallet-cli` nor `pi` were installed in this
workspace when Day 4 started. Both were installed
(`npm i -g @ledgerhq/wallet-cli @earendil-works/pi-coding-agent`) and
verified working (`wallet-cli --version` → 2.1.0, `pi --version` → 0.85.1,
matching the versions already on record). The user's own words: build it
for real, code-only where hardware is required, a friend tests the
hardware-dependent paths separately.

- [x] `@finity/pi-package`: HCS-14 identity generation (`generateIdentity`),
  deterministic and fully tested — resolves the ADR-005 blocker by
  depending on `@hashgraphonline/standards-sdk` directly instead of the
  broken `@hol-org/standards-sdk` wrapper (still `workspace:*`-broken).
- [x] `@finity/pi-package`: DMK node-hid `signTypedData`
  (`signTypedDataOnDevice`) — discover → connect → sign → disconnect
  against the verified DMK API surface. `assembleSignature` (r/s/v → 65-byte
  hex, matching `MandateRegistry.sol`'s `_recover` normalization) is pure
  and tested; the device sequence itself is `HW-UNVERIFIED`.
- [x] `@finity/pi-package`: Broker Session Key generation, `wallet-cli ring
  encrypt` sealing, and the user-story-5 recovery test reusing
  `vault-worker`'s existing decrypt seam — tested with an injected
  wallet-cli runner, and the recovery-test failure path additionally
  verified against the real installed wallet-cli (no ring initialized).
- [x] `@finity/pi-package`: the mandate registration wizard
  (`registerMandateOnChain`) — compile → sign → register on-chain → create
  and bind an HCS trace topic, strictly ordered so a declined signature or
  a failed registration never leaves a dangling trace topic.
- [x] `@finity/pi-package`: `/finity setup` wizard orchestration
  (`runSetupWizard`), fully tested against injected fakes for every step
  and every failure branch.
- [x] `@finity/pi-package`: the actual Pi extension
  (`extensions/finity.ts`) — 6 tools (`finity_discover/quote/purchase/
  explain_refusal/request_escalation/status`), the `finity` command
  (`setup`/`mandate new|list|show`/`doctor`/`escalations`/`trace`/`revoke`
  — `revoke` not yet implemented, said so explicitly rather than faking
  it), and a `tool_call` blocker on `bash`/`write`/`edit`.
- [x] `@finity/pi-package`: `finity-buyer` skill (tool sequence, what a
  mandate is, refusals are final unless escalated, never ask for keys).
- [x] `finity` wrapper package (`packages/finity-cli`): resolves
  `@finity/pi-package`'s extension root and `@finity/finityd`'s daemon
  script from its own workspace dependencies, starts `finityd` if it isn't
  already answering a health check, then execs `pi --no-builtin-tools -e
  <pi-package root> --system-prompt <finity prompt>`. `finity broker` runs
  the daemon alone, headless, for a VPS.
- [x] `@finity/finityd`: `createLiveDependencies` extracted from the Day 3
  gated script so the CLI script and the new daemon share one
  implementation instead of drifting; the CLI script now just loads a
  mandate fixture and calls it.
- [x] `@finity/finityd`: the long-running daemon bin (`daemon.ts`) — loads
  every mandate under `~/.finity/mandates/*.json`, decrypts the Broker
  Bundle via `vault-worker`'s existing seam, starts the HTTP API with a
  real executor, persists to `~/.finity/finityd.db`, and writes
  `~/.finity/finityd.runtime.json` for other local processes to find.
- [x] `@finity/finityd`: wired `GET /v1/services` and `POST /v1/quotes` for
  real (they existed in the route allowlist since Day 3 but always 501'd —
  pure software, no reason to leave them gated behind hardware).
- [x] `wallet-cli genuine-check` / `ring init` against a physical Ledger.
- [ ] DMK node-hid discover/connect/`signTypedData` against a physical
  Ledger with the Ethereum app open; the r/s/v → 65-byte-hex convention in
  `assembleSignature` needs confirming against a real device response.
- [ ] A mandate actually registered on-chain by a real Ledger signature,
  and `finity` running end to end against it and deployed Day 2 services.

Two real, non-hardware bugs were found and fixed while building this:

- Hiero SDK's `PrivateKey.fromString()` is deprecated in favor of
  `fromStringECDSA()`/`fromStringDer()`; verified a raw viem-generated hex
  key round-trips identically through both, so this was a clean no-behavior
  -change fix across `commerce-adapter`, `paid-testnet.ts`, and
  `finityd-intent.ts`, not a real incompatibility.
- pi's extension loader (jiti) fails **any** extension with a *static*
  top-level import of `@ledgerhq/device-signer-kit-ethereum` anywhere in
  its module graph with `Cannot redefine property: module.exports` —
  confirmed by bisecting imports one at a time against the installed pi
  0.85.1 CLI. `ledger.ts` now imports all three Ledger DMK packages
  dynamically inside `signTypedDataOnDevice` instead, which sidesteps it
  entirely. See `docs/DX_FEEDBACK.md`.

Verified without hardware, using the real installed `pi` CLI: the full
`finity.ts` extension loads cleanly (as both TypeScript source and
compiled JS) alongside the `finity-buyer` skill; `/finity doctor` runs to
completion against a `finityd` that isn't running without crashing;
`finity broker` correctly spawns the daemon and inherits its stderr; the
default `finity` mode correctly detects no `finityd` is running, starts
it, and fails closed with a clear message after a bounded 5-second wait
rather than hanging, when no Broker Bundle has been sealed yet.

## Day 5 status — boundaries and evidence: code complete, tested without hardware

- [x] Every decision (REFUSED, ESCALATION_REQUIRED, AUTHORIZED - not just
  AUTHORIZED as Day 3/4 had it) now signs a DecisionReceipt and commits an
  HCS DECISION envelope, matching the build spec's F5 refusal flow
  exactly. The mandate's hash-chain tip advances after every envelope, not
  just at RECONCILED, so a refused purchase no longer orphans the chain
  for whatever comes after it. Found and fixed while wiring escalations,
  which need a receiptId to reference and had none before this.
- [x] Kill switch: `POST /v1/intents` refuses with 503 while
  `~/.finity/kill-switch` exists, `GET /v1/health` reports it, `/finity
  kill on|off` toggles the file directly (no signing - it's a local
  safety net). Verified for real against the installed `pi` CLI.
- [x] `mandate-compiler`: `compileRevocation`/`compileAmendment`, EIP-712
  typed data for the two other Ledger-signed artifacts
  `MandateRegistry.sol` accepts, with field order copied directly from
  `contracts/test/MandateRegistry.ts`'s own already-passing fixtures.
- [x] `/finity revoke <mandateId>`: real - signs a Revocation on the
  Ledger, calls `registryClient.revoke()`. A revoked mandate's on-chain
  status already flowed through to `MANDATE_INACTIVE` via Day 3/4's
  `createLiveDependencies`; this closes the loop with a real signing path.
- [x] Escalations, fully wired: `finity_request_escalation` (fixed a bug -
  it was passing `correlationId` where finityd expects the
  `refusal.receiptId`) → `EscalationStore` (`POST`/`GET /v1/escalations`,
  a new `POST /v1/escalations/:id/resolve`) → `/finity escalations
  approve|reject <id>` → `approveEscalation()` signs a MandateAmendment
  (with a *fresh* nonce - `ProposedAmendment.nonce` just echoes the
  mandate's own already-used registration nonce, a policy-engine quirk
  found while wiring this) → `registryClient.amend()` → the successor
  mandate is persisted and registered live with the running `finityd` via
  a new `POST /v1/mandates` (also backs a newly-real `GET /v1/mandates/:id`,
  both Day 3 stubs until now).
- [x] `packages/finityd/src/executor.test.ts` and `index.test.ts` cover
  the build spec's exact Day 5 scenarios by name: 1 authorized, 2
  refusals (PRICE_LIMIT_EXCEEDED → escalation, SERVICE_NOT_ALLOWED →
  terminal), 1 escalation approved then the retried purchase succeeds
  against the successor mandate, 1 escalation rejected, 1 revoked mandate
  → MANDATE_INACTIVE.
- [x] `@finity/verifier`: real signature verification, for the first time
  anywhere in this codebase - mandate (EIP-712, `recoverTypedDataAddress`),
  broker receipt signature (raw digest, `recoverAddress`, matching
  `signBrokerHash`'s actual scheme), manifest/quote (EIP-191,
  `recoverPublicKey`, per Day 2's ADR-006, unchecked by anything until
  now). Plus receipt-hash integrity, live-policy-hash comparison,
  on-chain registry state, HCS trace inclusion, and settlement-transaction
  checks. `finity-verify --receipt <file> --mandate <id> --registry-address
  <addr>` (plus optional `--mandate-file`/`--manifest-file`/`--quote-file`/
  `--settlement-tx`), exiting 0/1/2 for verified/insufficient_disclosure/
  invalid.
- [ ] `finity-verify` run against a real deployed registry, a real mirror
  node, and a real settlement transaction - untested without live
  infrastructure, same blocker as every other network-dependent piece.
- [ ] DMK `signTypedData` for Revocation/MandateAmendment against a
  physical device (the typed-data construction is verified against the
  contract's own test fixtures; the device round-trip is not).

"Expiry" and "recovery" (also named in step 19) needed no new work:
mandate expiry was already enforced by policy-engine's `MANDATE_EXPIRED`
check since Day 1, and the Broker Bundle recovery test was already built
in Day 4 (`verifyBrokerBundleRecovery`).

## Branches and commit cadence

- `foundation/scaffold`: steps 1–5; merge only after empty workspace build/test is green.
- `core/policy`: steps 6–9; merge only after pure-core and contract tests are green.
- `hedera/providers`: steps 10–11; merge after gated testnet evidence or documented blocker.
- `broker/runtime`: steps 12–16; merge after local E2E and adversarial checks.
- `ledger/integration`: steps 17–18; merge with physical-hardware items explicitly marked.
- `verification/evidence`: steps 19–20; merge after evidence and verifier checks.
- `release/judge-ready`: steps 21–22; merge after full QA and clean diff review.
- Each completed step gets its own focused commit; each phase branch is pushed before merge.

## Verification

- [x] `pnpm -r build` passes.
- [x] `pnpm -r typecheck` passes.
- [x] `pnpm -r test` passes.
- [x] Secrets/canaries are absent from source, fixtures, logs, and session artifacts.
- [x] Pure packages have no I/O, clock, or network imports.
- [x] Required docs are current: VERIFIED, HW_TODO, DX_FEEDBACK, DECISIONS, BLOCKERS.
- [x] Git diff contains only scoped changes and all phase branches/commits are pushed where possible.

## Review

### Changed

- Hardware E2E run plan and evidence for the 2026-09-08 pulled-main check.
- `docs/HW_TODO.md`: physical genuine-check marked verified.
- `@finity/provider-sdk`: signed manifests, deterministic quotes/usage receipts, x402 Express payment middleware, and fail-closed facilitator configuration.
- `services/hello-weather` and `services/summarize-lite`: paid Hedera service skeletons with deterministic handlers and quote rules.
- `@finity/registry-client`: viem MandateRegistry adapter, Hiero HCS writer, and same-origin mirror-node reader.
- `docs/VERIFIED.md` and `docs/DECISIONS.md`: provider/registry API evidence and HCS-14 packaging decision.
- Testnet bootstrap branch: Key Ring initialization and funded operator preflight evidence.

### Verified

- `origin/main` was already current at `4d83131e185251523b3214dbb80804d846439c14`.
- Physical Ledger genuine-check passed after returning the device to the dashboard.
- Physical Ledger Key Ring initialization passed after the user provisioned the
  `ledger-wallet-cli` password in macOS Keychain; `ring keys` returns an
  initialized ring with no plaintext keys exposed.
- `0.0.8260226` is a funded ECDSA Hedera testnet operator account; a read-only
  SDK balance query returned approximately 954.93 HBAR.
- `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass.
- Source and fixture canary/password scan is clean.
- Provider, service, and registry package builds, typechecks, and focused tests pass.
- Full monorepo build/typecheck/test pass; scoped secret and pure-core scans are clean.
- No HCS write or testnet contract transaction was claimed without funded credentials and a deployed address.

### Risks

- Mandate signing still requires the Ledger Ethereum app; the HBAR app is not the current DMK signing target.
- Physical Ledger mandate signing, live contract deployment, HCS writes, and Blocky402 settlement remain unverified.
- HCS-14 package installation is deferred because its published workspace dependency is unresolved.

### Follow-ups

- Continue `verification/testnet-bootstrap`: create the broker/provider accounts,
  deploy the registry, and run the Ledger Ethereum-app mandate signing flow.
- Continue with `broker/runtime` later: vault isolation, commerce adapter, negotiator, capability, trace builder, daemon, and local E2E.

### Unresolved questions

- Physical Ledger hardware and funded Hedera accounts are not available in this workspace yet.
- Remote push/merge permissions depend on the configured GitHub credentials.
