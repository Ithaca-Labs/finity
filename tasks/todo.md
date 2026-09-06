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
- [ ] 10. Implement `@finity/provider-sdk` and the two demo service skeletons.
- [ ] 11. Implement `@finity/registry-client` for mirror, HCS, and Hashio access.
- [ ] 12. Implement `@finity/vault-worker` with Key Ring isolation, egress, injection, and redaction.
- [ ] 13. Implement `@finity/commerce-adapter` with x402 challenge binding.
- [ ] 14. Implement `@finity/negotiator`, `@finity/capability`, and `@finity/trace-builder`.
- [ ] 15. Implement `@finity/finityd` HTTP API and reducer-backed SQLite orchestration.
- [ ] 16. Add local end-to-end flow and gated Hedera testnet payment flow.
- [ ] 17. Add Ledger setup and mandate-signing interfaces, marking hardware-unverified paths.
- [ ] 18. Add `@finity/pi-package`, the buyer skill, tool blocker, and wrapper CLI.
- [ ] 19. Add refusal, escalation, revocation, expiry, kill-switch, and recovery paths.
- [ ] 20. Implement `@finity/verifier` and tamper/insufficient-disclosure checks.
- [ ] 21. Build `pnpm demo`, README architecture/payment docs, and judge-facing evidence.
- [ ] 22. Run full QA, secret-leak checks, review diffs, push/merge phase branches, and record risks.

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
- [ ] Secrets/canaries are absent from source, fixtures, logs, and session artifacts.
- [x] Pure packages have no I/O, clock, or network imports.
- [ ] Required docs are current: VERIFIED, HW_TODO, DX_FEEDBACK, DECISIONS, BLOCKERS.
- [ ] Git diff contains only scoped changes and all phase branches/commits are pushed where possible.

## Review

### Changed

### Verified

### Risks

### Follow-ups

### Unresolved questions

- Physical Ledger hardware and funded Hedera accounts are not available in this workspace yet.
- Remote push/merge permissions depend on the configured GitHub credentials.
