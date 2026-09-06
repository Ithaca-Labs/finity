# Architecture decisions

## ADR-001: Phase branches and focused commits

- Date: 2026-09-07
- Decision: Build on domain-oriented phase branches (`foundation/scaffold`, `core/policy`, `hedera/providers`, `broker/runtime`, `ledger/integration`, `verification/evidence`, and `release/judge-ready`), with each spec completion criterion in its own focused commit and each phase pushed before merge.
- Reason: Preserve bisectable milestones and prevent a single unreviewable project commit.

## ADR-002: Live HCS-14 API controls implementation

- Date: 2026-09-07
- Decision: Use the verified `@hol-org/standards-sdk` re-exported HCS-14 API (`canonicalizeAgentData`, `createUaid`, or `HCS14Client`) when identity code is added.
- Reason: The inspected 0.1.186 declarations do not expose the older `resolveAgent`/`registerAgent` API described in the initial spec note.
