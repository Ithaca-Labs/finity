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

## ADR-006: Provider artifacts use EIP-191 signatures over JCS

- Date: 2026-09-07
- Decision: The Day 2 provider runtime signs the RFC 8785 canonical JSON string
  for manifests, quotes, and usage receipts with viem `signMessage`; the
  manifest records the corresponding secp256k1 public key. The verifier phase
  will recover and compare the EIP-191 signer rather than treating a signature
  string as self-authenticating.
- Reason: These are Finity-native artifacts, not an x402 or EIP-712 standard
  schema. EIP-191 binds the exact canonical bytes while providing a concrete,
  independently recoverable signature format.

## ADR-007: Resolve ADR-005 by depending on `@hashgraphonline/standards-sdk` directly

- Date: 2026-09-07
- Decision: `@finity/pi-package`'s HCS-14 identity code depends on
  `@hashgraphonline/standards-sdk@0.1.186` directly, not the
  `@hol-org/standards-sdk` wrapper.
- Reason: `@hol-org/standards-sdk@0.1.186` still declares
  `@hashgraphonline/standards-sdk: workspace:*` and still fails to install
  in this monorepo (re-verified, ADR-005's blocker is unchanged). The
  package it wraps and merely re-exports installs and works cleanly on its
  own (`canonicalizeAgentData`, `createUaid`, `HCS14Client` all present and
  exercised directly, per ADR-002). This is not a replacement package or an
  invented fallback - it is the same code ADR-002 already verified,
  reached without the broken wrapper. The published `.d.ts` for this
  package has its own defect (see ADR-008's note on `identity.ts`'s type
  assertion) that is unrelated to the packaging issue ADR-005 identified.

## ADR-008: Ledger DMK packages are imported dynamically, not statically

- Date: 2026-09-07
- Decision: `@finity/pi-package`'s `ledger.ts` imports
  `@ledgerhq/device-management-kit`, `@ledgerhq/device-transport-kit-node-hid`,
  and `@ledgerhq/device-signer-kit-ethereum` with a dynamic `import()` inside
  `signTypedDataOnDevice`, not static top-level imports.
- Reason: Bisecting imports one at a time against the installed pi 0.85.1
  CLI showed that pi's extension loader (jiti) fails to load **any**
  extension with a *static* top-level import of
  `@ledgerhq/device-signer-kit-ethereum` anywhere in its module graph,
  with `Cannot redefine property: module.exports` -
  `@ledgerhq/device-management-kit` and
  `@ledgerhq/device-transport-kit-node-hid` alone did not trigger it.
  Dynamic `import()` avoids the failure entirely (verified: the full
  `finity.ts` extension loads cleanly under the real `pi` CLI with this
  change) and only pays the load cost when a mandate is actually being
  signed. Recorded as dev-tooling feedback in `docs/DX_FEEDBACK.md`.

## ADR-009: mandate-wizard.ts's `identity.ts` type assertion for standards-sdk

- Date: 2026-09-07
- Decision: `identity.ts` imports `@hashgraphonline/standards-sdk` as a
  namespace (`import * as standardsSdk`) and asserts the shape of
  `canonicalizeAgentData`/`createUaid`/`CanonicalAgentData` with a
  documented `as unknown as {...}` cast, instead of importing them by name.
- Reason: The package's published `dist/es/index.d.ts` does not surface
  these three names through its `export *` barrel chain under TypeScript's
  `nodenext` module resolution (`hcs-14/sdk.d.ts` reaches into a
  bundled-relative path, `../../node_modules/@hashgraph/sdk`, that does not
  resolve, which appears to break the re-export even under `skipLibCheck`).
  Runtime resolution is unaffected - both functions were called directly
  and verified working before this was written. The cast documents a real
  gap in a third-party package's declarations rather than silently
  papering over it or inventing an unverified workaround.

## ADR-010: every purchase decision signs a receipt, not just AUTHORIZED

- Date: 2026-09-07
- Decision: `@finity/finityd`'s executor now builds and signs a
  DecisionReceipt and commits an HCS DECISION envelope for REFUSED and
  ESCALATION_REQUIRED outcomes too, not only AUTHORIZED. The mandate's
  hash-chain tip (`MandateStore.recordReceiptHash`) advances after every
  envelope emitted during a purchase, not just at RECONCILED.
- Reason: FINITY_BUILD_SPEC.md's F5 refusal flow is explicit - "Policy
  Engine returns REFUSED ... -> signed refusal receipt -> HCS DECISION
  commitment" - and `POST /v1/escalations {receiptId}` needs a receiptId
  to reference, which nothing produced for an escalation before this.
  The original Day 3 design only signed a receipt after RESERVED (with a
  real reservationId baked in); `reservationId` was already optional in
  the schema, so building the receipt right after `evaluate()` for all
  three outcomes needed no schema change. Discovered while wiring
  escalations end to end for Day 5, not anticipated at Day 3.

## ADR-011: escalation approval and revocation use a fresh, timestamp-based nonce

- Date: 2026-09-07
- Decision: `/finity revoke` and `approveEscalation()` sign their
  Revocation/MandateAmendment with `nonce: String(Date.now())`, not a
  value taken from anywhere else in the system.
- Reason: `MandateRegistry.sol` scopes `usedNonces` per principal across
  *all* signed artifacts (registration, revocation, amendment) as one
  namespace. policy-engine's `ProposedAmendment.nonce` echoes the
  original mandate's own registration nonce (`nonce: mandate.nonce`),
  which the contract already marked used when that mandate was
  registered - signing an amendment with it as-is reverts with
  `NonceAlreadyUsed`. policy-engine is a pure package (no I/O/clock, a
  Day 1 invariant) and genuinely cannot know what nonce is safe to use,
  so this is not a bug to fix there; the caller, which does have a clock,
  supplies a fresh one instead. Found while wiring the escalation
  approval flow end to end for Day 5, documented rather than silently
  worked around.
