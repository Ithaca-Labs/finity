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
