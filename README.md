# Finity

Ledger-governed commerce network on Hedera testnet.

This repository is being built in the phase order in `FINITY_BUILD_SPEC.md`. Start with:

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

No funded accounts, contract address, HCS topic IDs, provider URLs, or hardware claims are recorded until verified and added to `docs/VERIFIED.md`.

## Day 2 operator commands

The two provider processes require their own Hedera account IDs, public HTTPS
origins, and provider-owned ECDSA signing keys. Copy `.env.example` to a
private `.env` file and supply those values through the deployment environment.
Never use the Broker Session Key as a provider signing key.

```bash
pnpm provider:weather
pnpm provider:summarize
```

Once both public services are reachable and the HCS operator is funded, publish
their signed manifests and run the real payment check. Both commands fail closed
until `FINITY_TESTNET=1` is set deliberately.

```bash
FINITY_TESTNET=1 pnpm registry:seed
FINITY_TESTNET=1 pnpm testnet:paid
```

Record the resulting topic and settlement transaction IDs in
`docs/VERIFIED.md` before claiming the Hedera testnet flow is complete.
