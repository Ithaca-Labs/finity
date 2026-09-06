# Verified facts

Verified on 2026-09-07 in this workspace. Live sources supersede this record.

## Toolchain

Commands and observed output:

```text
node --version -> v22.22.2
pnpm --version -> 10.12.1
wallet-cli --version -> {"ok":true,"data":{"type":"version","name":"wallet-cli","version":"2.1.0"}}
pi --version -> 0.85.1
```

The Ledger agent skills were installed from `LedgerHQ/agent-skills` for wallet-cli and DMK implementation.

## Endpoint probes

Blocky402 testnet:

```text
GET https://api.testnet.blocky402.com/supported
{"kinds":[{"x402Version":2,"scheme":"exact","network":"eip155:80002"},{"x402Version":2,"scheme":"exact","network":"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1","extra":{"feePayer":"7B6Q2MvcJvNcy1A13wHmAzmmdo3L8DVriaXML7bvkojm"}},{"x402Version":2,"scheme":"exact","network":"hedera:testnet","extra":{"feePayer":"0.0.7162784"}}],"extensions":[],"signers":{"eip155:*":["0xDCF7D72C2eE049DE4269ac6AAf925F33efdA18de"],"solana:*":["7B6Q2MvcJvNcy1A13wHmAzmmdo3L8DVriaXML7bvkojm"],"hedera:*":["0.0.7162784"]}}
```

Hedera mirror node:

```text
GET https://testnet.mirrornode.hedera.com/api/v1/network/nodes
HTTP 200; response has a `nodes` array and `links.next: null`.
Observed node accounts include 0.0.3, 0.0.4, 0.0.5, 0.0.6, 0.0.7, 0.0.8, and 0.0.9. Each node exposes service endpoints on ports 50211 and 50212.
```

Hashio:

```text
POST https://testnet.hashio.io/api
{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}
{"result":"0x128","jsonrpc":"2.0","id":1}
```

`0x128` is Hedera testnet EVM chain ID 296.

## Ledger Key Ring CLI

`wallet-cli ring --help` exposes only `init`, `encrypt`, `decrypt`, `keys`, and `destroy`. It has no `enroll`, `export`, or `import` subcommand.

Exact observed option summaries:

```text
ring init: --name/-n, --unsecure-no-password, --output (human|json)
ring encrypt: --key/-k, --input/-i, --out/-o, --output (human|json)
ring decrypt: --key/-k, --input/-i, --out/-o, --output (human|json)
```

`wallet-cli session view --output json` returned an empty session with `{"status":"success","command":"session view","network":"all","accounts":[],"timestamp":"..."}`. `wallet-cli ring keys --output json` failed closed with `Ledger Key Ring not initialized`.

The installed wallet-cli README states that `ring init` is device-required, `ring encrypt`/`ring decrypt` need network access but no device after initialization, and the ring is recoverable from the Ledger seed on a new machine. A tested second-host enrollment procedure is not available without the physical Ledger and its user-facing recovery flow; implementation must remain gated and marked hardware-unverified.

## Package APIs

Inspected from exact npm tarballs and declarations before dependent code:

- `@x402/core@2.25.0`: `x402Client`, `x402HTTPClient` from `@x402/core/client`; protocol types from `@x402/core/types`.
- `@x402/fetch@2.25.0`: `wrapFetchWithPayment(fetch, client)` and `wrapFetchWithPaymentFromConfig(fetch, config)` from `@x402/fetch`.
- `@x402/express@2.25.0`: `paymentMiddleware(routes, server, ...)`, `paymentMiddlewareFromConfig(routes, facilitatorClients, schemes, ...)`, and `ExpressAdapter` from `@x402/express`.
- `@x402/hedera@2.25.0`: `ExactHederaScheme` from `@x402/hedera/exact/client` and `/exact/server`; `createClientHederaSigner(accountId, privateKey, config?)`, `createHederaClient(network, nodeUrl?)`, and Hiero primitives re-exported from `@x402/hedera`. The client signer takes a Hiero `PrivateKey` and an account ID.
- `@hol-org/standards-sdk@0.1.186`: published package re-exports `@hashgraphonline/standards-sdk`. The live declaration exposes `HCS14Client`, `canonicalizeAgentData(input)`, and overloaded `createUaid(existingDid, params?)` / `createUaid(canonicalAgentData, params?, options?)`. The canonical agent schema requires `registry`, `name`, `version`, `protocol`, `nativeId`, and `skills`; this supersedes the older `resolveAgent`/`registerAgent` assumption in the spec for v1 identity generation.
- `@ledgerhq/device-signer-kit-ethereum@1.18.0`: `new SignerEthBuilder({ dmk, sessionId, originToken? }).build()`; `signTypedData(derivationPath, typedData, options?)` returns a device-action observable.
- `@ledgerhq/device-transport-kit-node-hid@1.0.1`: `NodeHidTransport`, `nodeHidTransportFactory`, and `nodeHidIdentifier` from the package root.
- `json-canonicalize@3.0.0`: `canonicalize(value, allowCircular?)` from the package root; returns a canonical JSON string.
- `viem@2.56.3`: used for EIP-712 hashing/recovery and JSON-RPC clients; exact call sites will be recorded when implemented.

## Pending live/hardware verification

- Physical Ledger genuine-check, DMK Node HID permissions, Ethereum app clear-signing rendering, and signer output remain unverified.
- Hedera account creation/faucet limits, Hashio deployment behavior, and funded testnet settlement IDs remain unverified.

