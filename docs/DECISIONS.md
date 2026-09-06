# Architecture decisions

## ADR-001: Phase branches and focused commits

- Date: 2026-09-07
- Decision: Build on domain-oriented phase branches (`foundation/scaffold`, `core/policy`, `hedera/providers`, `broker/runtime`, `ledger/integration`, `verification/evidence`, and `release/judge-ready`), with each spec completion criterion in its own focused commit and each phase pushed before merge.
- Reason: Preserve bisectable milestones and prevent a single unreviewable project commit.

## ADR-002: Live HCS-14 API controls implementation

- Date: 2026-09-07
- Decision: Use the verified `@hol-org/standards-sdk` re-exported HCS-14 API (`canonicalizeAgentData`, `createUaid`, or `HCS14Client`) when identity code is added.
- Reason: The inspected 0.1.186 declarations do not expose the older `resolveAgent`/`registerAgent` API described in the initial spec note.

## ADR-003: Registry mirrors the compiler's complete EIP-712 field set

- Date: 2026-09-07
- Decision: `MandateRegistry` hashes the full `AgentMandate` field list, including the human-readable display strings, with domain chain ID 296 and the deployed contract address.
- Reason: The contract digest must be independently cross-checkable against `@finity/mandate-compiler` and must reject any signature over a different display value.

## ADR-004: Local contract tests use chain ID 296

- Date: 2026-09-07
- Decision: Hardhat's default simulated network uses chain ID 296 and the registry uses optimizer + viaIR.
- Reason: This catches Hedera-domain signing mismatches locally; viaIR is required for the intentionally complete EIP-712 hash function under Solidity 0.8.24's stack limit.

## ADR-005: Defer HCS-14 identity dependency until packaging is fixed

- Date: 2026-09-07
- Decision: The provider/registry phase does not install or wrap `@hol-org/standards-sdk@0.1.186`; HCS-14 identity integration remains a later module item.
- Reason: The inspected published package declares `@hashgraphonline/standards-sdk@workspace:*`, which is unresolved in this monorepo and makes `pnpm install` fail. No replacement package or invented fallback was added. The live HCS-14 API remains recorded in ADR-002 for the identity phase.
