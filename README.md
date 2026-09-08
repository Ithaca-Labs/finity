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

## Day 4: Ledger setup, mandate signing, and the buyer agent

`packages/pi-package` is the Pi extension (seven `finity_*` tools, the
`/finity` command family, and the `finity-buyer` skill); `packages/finity-cli`
is the `finity` wrapper bin non-developers install. See `docs/HW_TODO.md`
for the remaining physical-device checks.

```bash
npm i -g @ledgerhq/wallet-cli @earendil-works/pi-coding-agent
pnpm --filter finity --filter @finity/pi-package --filter @finity/finityd build
node packages/finity-cli/dist/bin/finity.js   # or, once published: finity
```

For normal use, ask Pi to buy something. `finity_buy` first validates and
reuses an existing sealed broker and ACTIVE compatible mandate. If either is
missing, the same chat flow creates and immediately Key-Ring-seals a broker
key, asks the Ledger account to fund it, resolves the Hedera account ID,
asks the Ledger to sign a one-purchase/one-hour mandate, starts `finityd`,
and resumes the original purchase. Existing users see no setup prompts.

On macOS the wrapper loads `WALLET_PASS` from Keychain service
`ledger-wallet-cli`, account `default`; it never enters the chat. Manual
`/finity setup` and `/finity mandate new` remain available for diagnostics.
