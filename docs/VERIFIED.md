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
- `@x402/fetch@2.25.0`: `wrapFetchWithPayment(fetch, new x402Client().register("hedera:testnet", new ExactHederaScheme(signer)))` retries a 402 request with a payment payload. `x402HTTPClient.processResponse(response)` reports the post-payment settlement status. `PrivateKey` and `createClientHederaSigner` are imported from `@x402/hedera`, avoiding a direct SDK import in the payment client.
- `@x402/core@2.25.0`: `HTTPFacilitatorClient({ url })`, `x402ResourceServer(facilitator).register(network, scheme)`, `RoutesConfig`, and `FacilitatorClient` from `@x402/core/server`.
- `@hiero-ledger/sdk@2.87.0`: the package-root `Client` export is the Node client; `Client.forTestnet()` / `Client.forMainnet()` create clients, `setOperator(accountId, privateKey)` configures signing, and `TopicCreateTransaction({ topicMemo }).execute(client)` plus `TopicMessageSubmitTransaction({ topicId, message }).execute(client)` return responses whose `getReceipt(client)` confirms consensus. `privateKeyToAccount` is not a viem root export; it is imported from `viem/accounts`.
- `@hol-org/standards-sdk@0.1.186`: published package re-exports `@hashgraphonline/standards-sdk`. The live declaration exposes `HCS14Client`, `canonicalizeAgentData(input)`, and overloaded `createUaid(existingDid, params?)` / `createUaid(canonicalAgentData, params?, options?)`. The canonical agent schema requires `registry`, `name`, `version`, `protocol`, `nativeId`, and `skills`; this supersedes the older `resolveAgent`/`registerAgent` assumption in the spec for v1 identity generation.
- `@ledgerhq/device-signer-kit-ethereum@1.18.0`: `new SignerEthBuilder({ dmk, sessionId, originToken? }).build()`; `signTypedData(derivationPath, typedData, options?)` returns a device-action observable.
- `@ledgerhq/device-transport-kit-node-hid@1.0.1`: `NodeHidTransport`, `nodeHidTransportFactory`, and `nodeHidIdentifier` from the package root.
- `json-canonicalize@3.0.0`: `canonicalize(value, allowCircular?)` from the package root; returns a canonical JSON string.
- `viem@2.56.3`: `createPublicClient({ chain, transport: http(rpcUrl) })`, `createWalletClient({ account, chain, transport: http(rpcUrl) })`, `readContract`, and `writeContract` are the registry-client primitives; EIP-712 hashing/recovery remains in the compiler.
- `@finity/policy-engine` build emits `dist/POLICY_HASH`; current deterministic build descriptor hash is `0x37501b231d9111797415c034aeb2875598ff583b38c025326c97e7e7649453a6`.

## Contract toolchain

Verified from npm metadata and the installed package READMEs/types:

```text
hardhat -> 3.15.0
@nomicfoundation/hardhat-toolbox-mocha-ethers -> 3.0.7
@nomicfoundation/hardhat-ethers -> 4.0.15 (toolbox peer)
ethers -> 6.17.0
@nomicfoundation/hardhat-network-helpers -> 3.0.11 (toolbox peer)
solc -> 0.8.24 (Hardhat WASM compiler)
```

Hardhat 3 uses `defineConfig` from `hardhat/config`, the `plugins` array, and
`network.create()` in Mocha tests. The local simulated network is configured
with chain ID 296 so its EIP-712 digest matches the Hedera testnet domain.
The registry compiles with optimizer + viaIR because the canonical mandate
hash contains the complete clear-signing field set and otherwise exceeds the
Solidity stack limit.

Verified commands:

```text
pnpm --filter @finity/contracts build -> compiled MandateRegistry.sol
pnpm --filter @finity/contracts typecheck -> pass
pnpm --filter @finity/contracts test -> 5 passing
```

The test suite cross-checks the contract's EIP-712 struct/domain digest against
ethers 6.17.0 and covers registration, broker authorization, caps,
reservation finalization/release/timeout, expiry, revocation, trace topic
assignment, and one-time max-per-request amendments.

Provider and mirror verification:

```text
GET https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.1/messages?limit=1&order=asc
-> HTTP 200; {"messages":[],"links":{"next":null}}
```

`@finity/provider-sdk` uses the verified x402 Express path: an explicit
`FacilitatorClient` or `HTTPFacilitatorClient`, `x402ResourceServer.register`,
`ExactHederaScheme`, and `paymentMiddleware`. Its quote endpoint accepts
explicit method, unit, units, nonce, issued-at, and expiry values; malformed
input returns a generic 400 response. The provider services expose
`hello-weather@1` at 0.05 HBAR per call and `summarize-lite@1` at 0.01 HBAR
per 1,000-character unit using integer tinybar strings.

`@finity/registry-client` uses the verified `Client`/topic transaction APIs for
HCS writes, the mirror topic messages route for reads, and the Hashio EVM RPC
for `MandateRegistry` reads/writes. No funded account or live contract address
was available, so no HCS write or testnet contract transaction was claimed.

Phase verification on 2026-09-07:

```text
pnpm -r build -> pass
pnpm -r typecheck -> pass
pnpm -r test -> pass (5 contract, 8 schemas, 10 compiler, 50 policy, 6 provider, 4 registry, 1 per service)
scoped secret scan -> clean
pure core I/O/system-clock scan -> clean
```

## Day 2 execution status

The repository now includes local provider launch commands, a signed-manifest
registry seeder, and a real x402 payment client script. `registry:seed` and
`testnet:paid` refuse unless `FINITY_TESTNET=1`; no HCS write or HBAR payment
has been attempted from this workspace. Their transaction IDs must be recorded
here only after a funded testnet run.

## Pending live/hardware verification

- Physical Ledger genuine-check, DMK Node HID permissions, Ethereum app clear-signing rendering, and signer output remain unverified.
- Hedera account creation/faucet limits, Hashio deployment behavior, and funded testnet settlement IDs remain unverified.

## Day 3 implementation notes

`@x402/fetch@2.25.0` declarations confirm that `wrapFetchWithPayment(fetch, client)` accepts an `x402Client`; `@x402/hedera@2.25.0` declarations confirm `createClientHederaSigner(accountId, PrivateKey, { network })` and `ExactHederaScheme`. The commerce adapter uses these exact signatures only after separately validating the 402 requirements against the policy-authorized quote.

`better-sqlite3@12.6.2` and `@types/better-sqlite3@7.6.13` are pinned for the finityd purchase store. pnpm did not run its native build script in this workspace, so an actual on-disk SQLite runtime check is pending trusted developer approval; no persistence success is claimed yet.

## Day 3 execution status

`better-sqlite3`'s native build script is now approved via `onlyBuiltDependencies`
in `pnpm-workspace.yaml`; `pnpm install` fetched a prebuilt binary
(`prebuild-install`, no local compiler toolchain needed) and
`packages/finityd/src/index.test.ts` proves `PurchaseStore` persists across a
close/reopen cycle against a real file path, not just `:memory:`.

`@finity/negotiator` is implemented: `discover()` reads the registry HCS
topic via `@finity/registry-client`'s `readTopicMessages` and keeps the
newest manifest per mandate-allowed service; `quote()` requests a signed
quote from a manifest's `quoteEndpoint` and validates it names the
requested service/method before trusting it; `select()` is a pure,
deterministic cheapest-quote pick with a service-ID tiebreak.

`@finity/finityd`'s `createIntentExecutor` (`packages/finityd/src/executor.ts`)
wires negotiator, `@finity/policy-engine`, `@finity/capability`,
`@finity/commerce-adapter`, and `@finity/trace-builder` into the full F4
purchase reducer: `INTENT → DISCOVERED → QUOTED → EVALUATING → AUTHORIZED
→ RESERVED → PAID → DELIVERED → RECONCILED`, hash-chaining a
DECISION/PAYMENT/USAGE/RECONCILED trace envelope after each externally
visible step via `@finity/trace-builder`'s new `buildDecisionReceipt`.
`packages/finityd/src/executor.test.ts` drives this to `RECONCILED` and
separately to refusal, escalation, discovery failure, quote failure, and
payment failure, entirely against injected fakes (no network, no registry
contract, no Ledger). `MandateStore` holds each mandate's full off-chain
content and hash-chain tip locally, because `MandateRegistry.record()`
returns only consumption/status — not the original `allowedServices`/
`allowedMethods`/`asset` text — so finityd cannot reconstruct a full
mandate from on-chain state alone.

Two decisions were made explicitly rather than guessed:

- The executor takes an **injected `SnapshotBuilder`** rather than
  performing mandate/quote/manifest signature verification itself. No
  digest/recovery scheme for these has been decided or implemented
  anywhere in this codebase; that decision belongs to `@finity/verifier`
  (step 20). The gated script's builder trusts every signature
  unconditionally and says so.
- The mandate is **supplied to finityd directly** (a `MandateStore.set`
  call from a CLI-loaded fixture/JSON file), not through a new HTTP
  intake route. Mandate registration is Day 4's Ledger wizard's job; a
  route ahead of that wizard would be built against an undecided
  contract.

`pnpm finityd intent --file fixtures/intent-weather.json`
(`scripts/finityd-intent.ts`) runs one real F4 purchase against Hedera
testnet, gated by `FINITY_TESTNET=1` exactly like Day 2's `testnet:paid`
and `registry:seed`. It resolves the mandate via `@finity/mandate-compiler`'s
`compile()` (overriding the deployment- and policy-version-specific
fields — `broker`, `spendAccount`, `policyHash`, `verifyingContract`, the
validity window — from live env/`POLICY_HASH` rather than trusting a
stale checked-in fixture), builds a live `RegistryClient`, and extracts
the reservation ID from the contract's `ReservationCreated` event log via
viem's `decodeEventLog` — `RegistryClient.reserve()` only returns the
write's transaction hash, not the reservation ID the contract computes.
Broker Session Key signing for capabilities and decision receipts uses
viem's `sign({ hash, privateKey, to: "hex" })`: a raw secp256k1 signature
over the commitment hash, matching the `signature` schema's 65-byte hex
shape. It has not been run: it requires a funded broker account, the
Day 2 services deployed at public HTTPS origins, a `MandateRegistry`
deployment, and — because the checked-in mandate fixture's signature is a
placeholder, not a real Ledger signature — a mandate actually registered
on-chain by a real device-signed `AgentMandate` (Day 4). Running it
against a live `hello-weather` will also currently fail at the payment
step: `ServiceManifest` has no client-facing field for a paid method's
HTTP path (only `quoteEndpoint`/`healthEndpoint`), so the script
hardcodes `/weather` for `hello-weather@1:weather.current` as a stand-in
rather than inventing a general resolution rule.

```text
pnpm -r build -> pass (17 packages)
pnpm -r typecheck -> pass
pnpm typecheck -> pass (adds scripts/finityd-intent.ts via tsconfig.scripts.json)
pnpm -r test -> pass (5 contract, 8 schemas, 10 compiler, 50 policy, 6 provider,
  5 registry, 2 vault-worker, 2 commerce-adapter, 2 capability, 14 trace-builder,
  22 negotiator, 25 finityd, 1 per service)
```

Unrelated to Day 3 but discovered while verifying it: every package's
`test` script picks up compiled `dist/*.test.js` alongside `src/*.test.ts`
(no `vitest.config` excludes `dist`), so `pnpm -r test`'s reported test
counts are doubled everywhere, not only in packages touched this phase.
Pre-existing since Day 1; not fixed here.
