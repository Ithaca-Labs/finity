# Todo

## Plan

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
- [ ] 19. Add refusal, escalation, revocation, expiry, kill-switch, and recovery paths.
- [ ] 20. Implement `@finity/verifier` and tamper/insufficient-disclosure checks.
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
- [ ] `wallet-cli genuine-check` / `ring init` against a physical Ledger.
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

- `@finity/provider-sdk`: signed manifests, deterministic quotes/usage receipts, x402 Express payment middleware, and fail-closed facilitator configuration.
- `services/hello-weather` and `services/summarize-lite`: paid Hedera service skeletons with deterministic handlers and quote rules.
- `@finity/registry-client`: viem MandateRegistry adapter, Hiero HCS writer, and same-origin mirror-node reader.
- `docs/VERIFIED.md` and `docs/DECISIONS.md`: provider/registry API evidence and HCS-14 packaging decision.

### Verified

- Provider, service, and registry package builds, typechecks, and focused tests pass.
- Full monorepo build/typecheck/test pass; scoped secret and pure-core scans are clean.
- No HCS write or testnet contract transaction was claimed without funded credentials and a deployed address.

### Risks

- Physical Ledger, funded Hedera credentials, live contract address, HCS writes, and Blocky402 settlement remain unverified.
- HCS-14 package installation is deferred because its published workspace dependency is unresolved.

### Follow-ups

- Continue with `broker/runtime` later: vault isolation, commerce adapter, negotiator, capability, trace builder, daemon, and local E2E.

### Unresolved questions

- Physical Ledger hardware and funded Hedera accounts are not available in this workspace yet.
- Remote push/merge permissions depend on the configured GitHub credentials.
