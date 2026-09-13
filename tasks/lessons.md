# Lessons

## Branch and commit naming

- Mistake: Initial phase names and commit subjects were too generic for a multi-branch build.
- Rule: Use domain-oriented phase branches and imperative subjects that identify the exact milestone delivered.

## Generated contract types in CI

- Mistake: CI typechecked Hardhat tests before generating ignored TypeChain declarations.
- Rule: Run the workspace build before typecheck whenever tests import generated contract types.

## Secret-safe diagnostics

- Mistake: A diagnostic command printed the local `.env`, including private keys, into tool output.
- Rule: Never print `.env`; inspect only variable names, safe metadata, or explicitly redacted values.

## Pi extension manifests

- Mistake: Declared a compiled extension directory, allowing Pi to discover `.d.ts` files as extensions.
- Rule: Pi package manifests must name the runnable extension entry file when the build directory contains declarations or maps.

## Hedera EVM alias funding

- Mistake: Treated the absent numeric account ID as blocking after the user identified the EIP-712 signer as the destination.
- Rule: For an explicitly confirmed secp256k1 EVM alias, verify network and use Hedera alias transfer to auto-create the hollow account; never substitute an unconfirmed alias.

## First-purchase onboarding

- Mistake: Described fresh provisioning as the only path after setup already produced reusable broker and mandate state.
- Rule: First-purchase onboarding must validate and reuse existing state before generating keys, funding accounts, or requesting Ledger signatures.

## Daemon runtime freshness

- Mistake: A healthy long-running finityd from before a code fix was reused because startup checked health but not the daemon runtime version.
- Rule: Every broker startup check must require the current runtime contract version, so rebuilt code cannot silently run against a stale daemon.

## Registration-stage diagnostics

- Mistake: A safe generic registration category still hid whether the live failure happened during contract submission, confirmation, or HCS setup, and the command path lacked local Ledger signature verification.
- Rule: Keep every external registration stage explicitly classified and apply the same local signature check to every Principal mandate command.

## Mandate draft nonce reuse

- Mistake: `/finity mandate new` reused the caller's draft nonce across retries, causing a permanently consumed Hedera registry nonce to reject every fresh Ledger signature.
- Rule: A human-triggered new mandate must mint a fresh nonce for every registration attempt; draft files provide policy choices, not replayable registration identities.
