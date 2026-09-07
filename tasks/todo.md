# Todo

## Plan

- [x] 1. Verify Node, pnpm, wallet-cli, Pi, and required Ledger skills.
- [x] 2. Probe Blocky402 `/supported`, Hedera mirror, and Hashio chain ID.
- [x] 3. Verify package APIs from installed READMEs and type definitions.
- [ ] 4. Resolve CLI, Key Ring enrollment, node-hid, HCS-14, and x402 verification items.
- [x] 5. Scaffold the pnpm TypeScript monorepo, package scripts, CI, and environment template.
- [x] 6. Implement `@finity/schemas`: canonical JSON, hashes, schemas, and state reducers.
- [x] 7. Implement `@finity/mandate-compiler`: EIP-712 data and Ledger display model.
- [x] 8. Implement `@finity/policy-engine`: ordered fail-closed evaluation and policy hash.
- [x] 9. Implement and test `MandateRegistry.sol` locally; prepare testnet deployment.
- [x] 10. Implement `@finity/provider-sdk`, runnable x402 provider entry points, signed-manifest publishing, and the gated paid-request client.
- [x] 11. Implement `@finity/registry-client` for mirror, HCS, and Hashio access, including canonical service-manifest submission.
- [~] 12. Implement `@finity/vault-worker` with Key Ring isolation, egress, injection, and redaction.
- [~] 13. Implement `@finity/commerce-adapter` with x402 challenge binding.
- [~] 14. Implement `@finity/negotiator`, `@finity/capability`, and `@finity/trace-builder`.
- [~] 15. Implement `@finity/finityd` HTTP API and reducer-backed SQLite orchestration.
- [ ] 16. Add local end-to-end flow and gated Hedera testnet payment flow.
- [ ] 17. Add Ledger setup and mandate-signing interfaces, marking hardware-unverified paths.
- [ ] 18. Add `@finity/pi-package`, the buyer skill, tool blocker, and wrapper CLI.
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

## Day 3 status — security primitives started, end-to-end remains blocked on Day 2 evidence

- [x] Single-use capability minting/lease guard, canonical trace envelopes, and unit tests.
- [x] Vault request allowlist, redirect blocking, scoped credential injection, and redaction tests.
- [x] x402 challenge-to-quote binding before retry/signing and the mismatched-`payTo` adversarial test.
- [x] Localhost bearer-token API and reducer-backed SQLite purchase store implementation.
- [ ] Wire the existing registry/negotiator/provider clients into the injected `finityd` executor.
- [ ] Finish the exact Key Ring OS-keychain reader and run a hardware-gated decrypt test.
- [ ] Run native `better-sqlite3` build approval in the project’s trusted developer environment, then test durable on-disk state.
- [ ] Run F4 against deployed Day 2 services and record the real HCS trace/payment evidence.

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
