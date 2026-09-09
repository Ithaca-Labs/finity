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
- `@hiero-ledger/sdk@2.87.0`: `AccountCreateTransaction.setECDSAKeyWithAlias(key)` creates an ECDSA account with an EVM alias, `setInitialBalance(new Hbar(amount))` funds it, and the receipt exposes the resulting `accountId`.
- `@hiero-ledger/sdk@2.87.0`: `TopicMessageSubmitTransaction` chunks messages at the SDK's 1,024-byte `CHUNK_SIZE`; the mirror REST payload exposes `chunk_info.initial_transaction_id`, `number`, and `total`. `readTopicMessages` now reassembles these chunks before returning UTF-8 messages.
- `@hol-org/standards-sdk@0.1.186`: published package re-exports `@hashgraphonline/standards-sdk`. The live declaration exposes `HCS14Client`, `canonicalizeAgentData(input)`, and overloaded `createUaid(existingDid, params?)` / `createUaid(canonicalAgentData, params?, options?)`. The canonical agent schema requires `registry`, `name`, `version`, `protocol`, `nativeId`, and `skills`; this supersedes the older `resolveAgent`/`registerAgent` assumption in the spec for v1 identity generation.
- `@ledgerhq/device-signer-kit-ethereum@1.18.0`: `new SignerEthBuilder({ dmk, sessionId, originToken? }).build()`; `signTypedData(derivationPath, typedData, options?)` returns a device-action observable.
- `@ledgerhq/device-transport-kit-node-hid@1.0.1`: `NodeHidTransport`, `nodeHidTransportFactory`, and `nodeHidIdentifier` from the package root.
- `json-canonicalize@3.0.0`: `canonicalize(value, allowCircular?)` from the package root; returns a canonical JSON string.
- `viem@2.56.3`: `createPublicClient({ chain, transport: http(rpcUrl) })`, `createWalletClient({ account, chain, transport: http(rpcUrl) })`, `readContract`, and `writeContract` are the registry-client primitives; EIP-712 hashing/recovery remains in the compiler.
- `viem@2.56.3`: `deployContract` is exported from `viem/actions`; it accepts the verified wallet client, artifact ABI, and bytecode and returns a transaction hash for `waitForTransactionReceipt`.
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

`pnpm testnet:bootstrap` is the guarded live setup command on the
`verification/testnet-bootstrap` branch. With `FINITY_TESTNET=1`, it creates
missing ECDSA broker/provider accounts from fresh local keys, deploys the
compiled `MandateRegistry` through Hashio, creates the HCS service registry
topic, seals the broker bundle through the initialized wallet-cli Key Ring,
and writes generated values only to the ignored, mode-600 local `.env`.

## 2026-09-08 live Hedera testnet bootstrap

All values below are public identifiers; private keys remain local only.

- Broker/Spend Account: `0.0.10423102`; account creation transaction:
  `0.0.8260226@1788877970.198833346`; funded with 50 HBAR initially.
- Provider A: `0.0.10423105`; account creation transaction:
  `0.0.8260226@1788877975.613280407`; funded with 10 HBAR initially.
- Provider B: `0.0.10423106`; account creation transaction:
  `0.0.8260226@1788877976.808042274`; funded with 10 HBAR initially.
- `MandateRegistry` contract: EVM address
  `0xcbc39351ca205fd291b73d0c31904590c3098d89`, Hedera contract ID
  `0.0.10423109`; deployment transaction:
  `0xd061ebd1a6657d5ad66fb49f35510a5d176772ee7e880901b40444f36c2ffdd2`.
- Service registry HCS topic: `0.0.10423110`; creation transaction:
  `0.0.8260226@1788877983.471829810`.
- Signed manifest `hello-weather@1` hash:
  `0x4d7ee12d450c5468991ca2b15c6004bd7791ff4e9838f93885ed3127067738b8`;
  submission transaction `0.0.8260226@1788878025.516291780`.
- Signed manifest `summarize-lite@1` hash:
  `0x5f4cdbb27adcb9f27f42444a5d713db9d10233a065a4d7b911fdf8f85eecada1`;
  submission transaction `0.0.8260226@1788878030.851834482`.
- Mirror node verified the contract as not deleted and returned four HCS
  chunks (two chunks per manifest). The fixed reader reassembled them, and a
  live discovery call returned both service IDs with their localhost origins.
- Blocky402 `/supported` advertises `hedera:testnet` with fee payer
  `0.0.7162784`; Hashio `eth_chainId` returned `0x128` (296).

## Pending live/hardware verification

- Physical Ledger genuine-check, DMK Node HID permissions, Ethereum app clear-signing rendering, and signer output remain unverified.
- Hedera account creation/faucet limits, Hashio deployment behavior, and funded testnet settlement IDs remain unverified.

## 2026-09-08 hardware and operator preflight

- `wallet-cli genuine-check` passed against the connected physical Ledger after
  returning it to the dashboard; the two earlier HBAR-app attempts failed
  closed with exit 4 and `Wrong app. Open Ledger dashboard.`
- `wallet-cli ring init` completed after the user provisioned the
  `account=default, service=ledger-wallet-cli` macOS Keychain secret. The
  command output contained no password, and `wallet-cli ring keys --output
  json` returned an initialized ring with zero named keys.
- The configured `.env` contains `HEDERA_OPERATOR_ID=0.0.8260226` and a
  DER-encoded ECDSA key. The installed Hiero SDK's `Client.setOperator()` was
  verified to parse this DER form; the key value is intentionally not recorded.
- A read-only `AccountBalanceQuery` against Hedera testnet succeeded for
  `0.0.8260226`, returning `95493170133` tinybars (about 954.93 HBAR). The
  mirror node reports the account as ECDSA and not deleted.
- The next live writes are intentionally still pending: separate broker and
  provider accounts, `MandateRegistry` deployment, HCS registry topic, real
  Ledger Ethereum-app signature, and a paid x402 request.

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

## Day 4 execution status

Toolchain re-verified in this workspace on 2026-09-07 (a fresh session; the
Day 0 toolchain record above was from an earlier one):

```text
node --version -> v24.13.1
npm i -g @ledgerhq/wallet-cli @earendil-works/pi-coding-agent -> installed cleanly
wallet-cli --version -> {"ok":true,"data":{"type":"version","name":"wallet-cli","version":"2.1.0"}}
pi --version -> 0.85.1
```

`@ledgerhq/device-management-kit@1.9.0`, `@ledgerhq/device-signer-kit-ethereum@1.18.0`
(both already recorded), and `@ledgerhq/device-transport-kit-node-hid@1.0.1`
install cleanly as workspace dependencies of `@finity/pi-package`.
`node-hid`, `usb`, `keccak`, and `protobufjs`'s native build scripts are
now approved (`pnpm-workspace.yaml`'s `onlyBuiltDependencies`) and built
successfully via prebuilt binaries (`prebuild-install`/`node-gyp-build`,
no local compiler toolchain needed) - no device was plugged in, so this
confirms the bindings compile, not that HID access itself works.

`@hashgraphonline/standards-sdk@0.1.186` (the package `@hol-org/standards-sdk`
re-exports, per the existing "Package APIs" section) installs and works
cleanly on its own; `@hol-org/standards-sdk@0.1.186` itself still declares
`@hashgraphonline/standards-sdk: workspace:*` and still fails to install
(ADR-005's blocker, re-checked, unchanged). See ADR-007.

Real, verified DMK API surface (used by `signTypedDataOnDevice`, beyond
what was already recorded): `new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build()`;
`dmk.startDiscovering({ transport: nodeHidIdentifier })` returns
`Observable<DiscoveredDevice>`; `dmk.connect({ device })` returns
`Promise<DeviceSessionId>`; `signer.signTypedData(derivationPath, typedData)`
returns `{ observable: Observable<DeviceActionState<Signature, Error,
Intermediate>>, cancel() }` where `DeviceActionState` is a status-discriminated
union (`DeviceActionStatus.Completed` carries `{ output: Signature }`,
`.Error` carries `{ error }`); `Signature = { r: HexaString, s: HexaString,
v: number }`.

Real, verified: Hiero SDK's `PrivateKey.fromString(text)` is deprecated
(prints a runtime warning) in favor of `fromStringECDSA(text)` for a raw
hex-encoded ECDSA key or `fromStringDer(text)` for a DER-prefixed one.
Directly tested: a raw viem `generatePrivateKey()` hex string round-trips
identically through both `fromString` and `fromStringECDSA` -
`toStringRaw()` matches, and the key derives the same EVM address via
`privateKeyToAccount` as it does natively in viem. Fixed across
`commerce-adapter`, `paid-testnet.ts`, and `finityd-intent.ts`.

`@hashgraphonline/standards-sdk`'s HCS-14 API, tested directly:
`canonicalizeAgentData(input)` returns `{ normalized: CanonicalAgentData,
canonicalJson }`; `createUaid(canonicalData, { uid }?, { includeParams:
true }?)` is `async` and returns a deterministic `uaid:aid:<hash>;uid=...;
registry=...;nativeId=...` string (confirmed identical output across two
calls with the same input). `CanonicalAgentData.skills` is `number[]`, not
`string[]` as might be assumed from the field name alone. The package's
own published `.d.ts` does not surface these names from its root export
under TypeScript `nodenext` resolution even though they work correctly at
runtime - see ADR-009.

Real, verified failure discovered while building the Pi extension: pi
0.85.1's extension loader (jiti) fails **any** extension with a *static*
top-level import of `@ledgerhq/device-signer-kit-ethereum` anywhere in its
module graph with `Cannot redefine property: module.exports` - confirmed
by bisecting imports one at a time in a minimal test extension against the
real installed CLI. A dynamic `import()` inside the function that needs it
avoids the failure entirely. See ADR-008 and `docs/DX_FEEDBACK.md`.

Verified for real without hardware, against the actual installed `pi`
CLI: `pi --no-builtin-tools -e src/extensions/finity.ts -p "hello"` loads
the full extension (all six `finity_*` tools, the `finity` command, the
`tool_call` blocker) and completes a normal turn; loading the compiled
`dist/extensions/finity.js` form works identically; adding
`--skill ./skills/finity-buyer` loads without error; `/finity doctor` (a
command, not requiring a model call to dispatch) runs to completion
against a `finityd` that is not running, without crashing.
`finity broker` (the wrapper bin's headless mode) correctly spawns
`@finity/finityd`'s daemon and inherits its stderr (observed: a clear
`ENOENT ... bundles/broker.enc` when no Broker Bundle has been sealed
yet). Default `finity` mode correctly detects no `finityd` is running,
attempts to start it, and fails closed with a clear message after a
bounded 5-second wait rather than hanging.

```text
pnpm -r build -> pass (17 of 18 workspace projects have a build script;
  adds @finity/pi-package's extension build and the new finity-cli package)
pnpm -r typecheck -> pass
pnpm typecheck -> pass
pnpm -r test -> pass (5 contract, 8 schemas, 10 compiler, 50 policy,
  6 provider, 5 registry, 2 vault-worker, 2 commerce-adapter, 2 capability,
  14 trace-builder, 22 negotiator, 34 finityd, 35 pi-package, 5 finity-cli,
  1 per service; several of these are already doubled by the pre-existing
  dist/*.test.js pickup noted above, since pnpm -r test builds dist before
  running - real counts are the ones stated here, halve what pnpm -r test
  itself prints)
```

Not run, and not claimed: `wallet-cli genuine-check`/`ring init` against a
physical device, DMK `signTypedData` against a physical device, `/finity
setup` end to end, `/finity mandate new` end to end, and any purchase via
the `finity_*` tools against a real `finityd`. See `docs/HW_TODO.md`.

## Day 5 execution status

Real, verified: viem exports `recoverAddress`, `recoverPublicKey`,
`recoverTypedDataAddress`, and `hashMessage` (used by `@finity/verifier`'s
checks). Directly tested that:

- `recoverAddress({ hash, signature })` correctly recovers the signer of a
  **raw**-digest `sign({ hash, privateKey, to: "hex" })` signature (no
  EIP-191/712 wrapping) - the exact scheme `@finity/finityd`'s
  `signBrokerHash` already used since Day 3/4 for capability and receipt
  signatures, now actually checked against for the first time.
- `recoverPublicKey({ hash: hashMessage(canonicalJson), signature })`
  correctly recovers a provider's declared `signingKey` from an EIP-191
  `account.signMessage()` signature over the canonical JSON - the scheme
  ADR-006 specified in Day 2 for manifests/quotes, unchecked by anything
  until `@finity/verifier`.
- `recoverTypedDataAddress` correctly recovers the Principal's address
  from a mandate re-compiled with `@finity/mandate-compiler`'s `compile()`
  and signed with `account.signTypedData(typedData)`.

All three round-trips are exercised with real viem test-account signatures
in `packages/verifier/src/checks.test.ts`, not fixture hex strings.

```text
pnpm -r build -> pass (18 of 19 workspace projects have a build script;
  adds @finity/verifier's checks/verify/cli build)
pnpm -r typecheck -> pass
pnpm typecheck -> pass
pnpm -r test -> pass (5 contract, 8 schemas, 2 capability, 20 compiler,
  2 commerce-adapter, 6 provider, 14 trace-builder, 2 vault-worker,
  5 registry, 50 policy, 22 negotiator, 48 verifier, 64 finityd,
  82 pi-package, 10 finity-cli, 1 per service - several of these are
  doubled by the pre-existing dist/*.test.js pickup already noted above)
```

Not run, and not claimed: everything already listed as not run above,
plus `/finity revoke`/`/finity escalations approve` signing on a physical
device, and `finity-verify` against a real deployed `MandateRegistry`,
mirror node, or settlement transaction. See `docs/HW_TODO.md`.

## 2026-09-08 hardware E2E attempt

Pulled `origin/main` with `git pull --ff-only origin main`; it was already at
`4d83131e185251523b3214dbb80804d846439c14`.

The connected physical Ledger was initially inside the HBAR app. Two
sequential `wallet-cli genuine-check` attempts failed closed with exit code 4
and the exact result `Wrong app. Open Ledger dashboard.` After the device was
returned to the dashboard, the same command completed successfully:

```text
Connect and unlock your Ledger on the dashboard…
Device is genuine
```

The installed wallet-cli Key Ring password lookup was checked without reading
or printing the secret. The macOS Keychain item
`account=default, service=ledger-wallet-cli` is absent. `wallet-cli ring init`
was therefore not attempted, because setup requires a password already
provisioned by the user and the agent must never choose, type, or receive it.

Software verification against the pulled tree:

```text
pnpm install --frozen-lockfile -> pass
pnpm build -> pass
pnpm typecheck -> pass
pnpm test -> pass
```

The run remains incomplete and no HBAR payment, mandate signature, registry
write, HCS trace, or Broker Bundle was claimed. Continue only after the user
stores the Key Ring password in the OS Keychain and opens the Ethereum app for
the DMK EIP-712 signing step. Required testnet credentials and public provider
origins are also unset in this workspace.

## 2026-09-08 user test audit

The user's Ledger signing attempt left a complete local mandate record. Live
read-only checks against the configured Hedera testnet registry confirmed:

```text
registry: 0xcbc39351ca205fd291b73d0c31904590c3098d89
mandate: 0x6910295d536615ee2b07340daf36aa710447f53ef3abdf112d7ec3dfe12b18ff
status: 1 (ACTIVE)
trace topic: 0.0.10423252
principal recovered from EIP-712 signature: 0xeAceF641c72286A4081A6D62Cc0c8d71a7d828b0
signature principal matches registry record: yes
trace messages: 1 (DECISION refusal)
```

This proves registration completed; it does not prove a successful purchase.
The trace contains one refusal decision because no successful payment has run.
The Key
Ring has the `broker:default` domain and the sealed bundle exists. After the
wallet-cli stdout decryption fix, `finityd` started and loaded one live
mandate when `WALLET_PASS` was supplied from the user-managed Keychain.
Configured provider origins are local development URLs
(`127.0.0.1:3001` and `127.0.0.1:3002`), not public HTTPS deployments.

Local smoke checks passed: both provider health endpoints returned 200 and both
quote endpoints returned signed quotes. After the usability patch,
`pnpm build`, `pnpm typecheck`, and `pnpm test` all pass.

The first live broker purchase was also exercised after fixing Key Ring
decryption. The daemon loaded the mandate and reached policy evaluation, but
the request was safely `REFUSED` with `QUOTE_INVALID` and no reservation or
HBAR payment. Root cause: provider startup regenerated `publishedAt`, changing
the manifest hash from the HCS-published manifest. Provider runtime now keeps
`publishedAt` stable or accepts an explicit configured timestamp; the existing
HCS manifests must be republished or matched with that timestamp before the
next live purchase.

## 2026-09-09 reservation decoder fix

The next Pi run successfully discovered `hello-weather@1` and received a
valid 0.05 HBAR quote. The purchase reached the registry, but the daemon
reported `FAILED_RESERVATION` because the client ABI omitted the
`ReservationCreated` event and therefore could not recover the reservation ID.
The reservation transaction did succeed:

```text
reservation tx: 0x187c624e08b21ef725dcb0ab9caf7c25f9c62c437717806e55aaf59b7313215a
reservation amount: 5000000 tinybars
```

Added the event ABI and a receipt-decoding test. The stranded reservation was
released before retrying:

```text
release tx: 0xe1a391ac064d9f42a283ee7690c1a86216fab3e1426da55bf783e9549869bd26
registry reserved after release: 0
```

No provider settlement or HBAR payment occurred. The daemon must be restarted
from the rebuilt tree before the next purchase attempt.

The subsequent retry recovered the reservation path but reached `FAILED_PAYMENT`.
The local provider returned HTTP 500 because `createFinityService` passed
`false` as `paymentMiddleware`'s `syncFacilitatorOnStart` flag, so the x402
resource server never initialized its facilitator capability map. Removing the
flag restored the expected 402 challenge; a fresh provider smoke test now
returns `402 Payment Required` with the Hedera testnet fee payer. The failed
payment path released its reservation; live registry state remains:

```text
reserved: 0
periodConsumed: 0
lifetimeConsumed: 0
```

## 2026-09-09 authorized purchase verified

After enabling the HBAR asset in the x402 client spend controls, a fresh
broker-mediated request completed end to end:

```text
correlationId: 3d984b72-1a23-423d-9cb7-d804b54d4fb5
state: RECONCILED
result: {"city":"Kolkata","condition":"clear","temperatureC":28}
amount: 5000000 tinybars (0.05 HBAR)
```

Public Hedera evidence:

```text
settlement transaction: 0.0.7162784-1788898976-660100298 (SUCCESS)
spend account: -5000000 tinybars
provider account: +5000000 tinybars
registry: reserved=0, periodConsumed=5000000, lifetimeConsumed=5000000
HCS trace: sequences 9-12 = DECISION, PAYMENT, USAGE, RECONCILED
```

## 2026-09-09 Ledger EVM principal funding

The testnet operator funded the Ledger-derived EIP-712 principal by sending
50 HBAR to its EVM alias. Hedera auto-created a hollow account for that alias:

```text
source: 0.0.8260226
destination EVM alias: 0xeAceF641c72286A4081A6D62Cc0c8d71a7d828b0
created account: 0.0.10427444
amount received: 5000000000 tinybars (50 HBAR)
transaction: 0.0.8260226-1788900863-017047227 (SUCCESS)
```

Mirror Node reports `key: null`, confirming the account remains hollow until
its first outbound EVM transaction is signed by the corresponding Ledger
Ethereum key.

## 2026-09-09 interactive onboarding API verification

Installed `@ledgerhq/device-signer-kit-ethereum@1.18.0` declarations confirm:

```text
getAddress(derivationPath, { checkOnDevice: true, chainId: 296 })
  -> device action output { address, publicKey, chainCode? }
signTransaction(derivationPath, transaction: Uint8Array, options?)
  -> device action output { r, s, v }
```

The Finity derivation path remains the fixed compiler constant
`44'/60'/0'/0/0`; chat input cannot change it. Hashio represents native HBAR
values in EVM transactions with 18-decimal EVM wei, so one tinybar is
`10^10` EVM wei. Mirror Node account lookup by EVM alias returns the created
numeric `0.0.x` account after funding.

`finity_buy` now validates reusable local state plus live registry status,
and finityd owns `/v1/mandates/register`; unit tests cover reuse, selective
mandate replacement, fresh provisioning order, cancellation before signing,
signature-v normalization, alias resolution, broker registration, restart
metadata, and absence of secrets from resumable state.

The reuse path was then exercised against the existing testnet setup without
allowing any interactive confirmation callback:

```text
reusedBroker: true
reusedMandate: true
correlationId: 471ecdcf-de75-49ea-a4e2-2d00daeef3df
state: RECONCILED
result: { city: Kolkata, condition: clear, temperatureC: 28 }
registry after: status=ACTIVE, reserved=0, lifetimeConsumed=15000000 tinybars
HCS sequences 17-20: DECISION, PAYMENT, USAGE, RECONCILED
```

This run exposed two trace-readability gaps that are now fixed: Mirror Node
currently includes `chunk_info` with `total=1` for ordinary messages, and the
x402 `PAYMENT-RESPONSE` header must be decoded to put its confirmed transaction
ID into the PAYMENT envelope. The latter is unit-verified and applies after
the rebuilt daemon is restarted; the live run above used the previously
running daemon and therefore has no transaction ID in sequence 18.

After merging, the old daemon was stopped and the rebuilt `main` daemon
started successfully and passed its authenticated health check.

## 2026-09-09 broker-relayed revocation route

`/finity revoke` no longer attempts a write through a read-only Pi-side
registry client. It sends only the canonical Ledger-signed Revocation to
finityd's authenticated `/v1/mandates/revoke` route. The daemon validates the
revocation/signature schemas, pays and broadcasts with the sealed Broker
Session Key, waits for the transaction receipt, verifies registry status code
`4` (`REVOKED`), and attempts an HCS `REVOKED` envelope. The Pi extension
clears the local pointer only when it still names the successfully revoked
mandate. Daemon and Pi package unit tests cover valid relay, malformed input,
relay failure, exact client payload, and stale-pointer protection. Physical
Ledger execution remains listed in `docs/HW_TODO.md` until the user approves
the live revocation.
