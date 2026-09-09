# Hardware verification TODO

- `[x] VERIFIED 2026-09-08`: `wallet-cli genuine-check` passed against the connected physical Ledger after the device was returned to the dashboard. The first two attempts correctly failed closed with exit 4 while the HBAR app was open.
- `[x] VERIFIED 2026-09-08`: `wallet-cli ring init` completed on the physical Ledger using the user-provisioned macOS Keychain secret; no password was placed in agent input or logs. `wallet-cli ring keys --output json` returned an initialized ring with zero named keys before bundle sealing.
- `HW-UNVERIFIED`: Complete and record second-host Key Ring recovery/enrollment.
- `HW-UNVERIFIED`: Run the new first-purchase funding path end to end: Ledger
  `getAddress(..., checkOnDevice: true)`, review a chain-296 native transfer,
  `signTransaction` over the serialized transaction, broadcast through Hashio,
  and confirm hollow-account completion plus broker alias creation.
- `HW-UNVERIFIED`: Run DMK Node HID discovery/connect/signing with Ethereum app open (`@finity/pi-package`'s `signTypedDataOnDevice`). In particular, confirm the r/s/v → 65-byte-hex assembly in `assembleSignature` against a real device response — the v-below-27 normalization mirrors `MandateRegistry.sol`'s `_recover` but has never been checked against what the Ethereum app actually returns.
- `HW-UNVERIFIED`: Photograph Ledger clear-signing fields and record exact string/uint rendering in `docs/dx/`.
- `HW-UNVERIFIED`: Verify Node HID permissions on the actual target OS (macOS/Linux udev rules, or Windows driver access — this workspace is Windows; `node-hid`'s and `usb`'s native builds installed cleanly via prebuilt binaries here, but no device has been plugged in to confirm HID access itself).
- `[x] VERIFIED 2026-09-09`: `vault-worker` recovered the real encrypted Broker Bundle through wallet-cli using the user-managed Keychain password; finityd loaded one live mandate without exposing plaintext.
- `[x] VERIFIED 2026-09-08`: Testnet bootstrap created explicit ECDSA broker/provider accounts and recorded the resulting IDs; the broker Spend Account is `0.0.10423102` and provider accounts are `0.0.10423105` / `0.0.10423106`. The separate broker session key is sealed in the local Key Ring bundle.
- `[~] USER-VERIFIED 2026-09-08`: A mandate signature was produced from the user's Ledger attempt and is now registered on-chain; live EIP-712 recovery matches the recorded principal. The agent's direct DMK device session remains unobserved.
- `[x] VERIFIED 2026-09-09`: Broker-mediated authorized weather purchase reached `RECONCILED`; public Hedera transfer and HCS DECISION/PAYMENT/USAGE/RECONCILED evidence were confirmed.
- `HW-UNVERIFIED`: `/finity revoke` signing a Revocation on a physical device and confirming the broker-relayed transaction reaches registry status `REVOKED` plus an HCS `REVOKED` envelope. The narrow daemon route and failure behavior are unit-verified; do not mark the live mandate revoked until the user approves it on Ledger.
- `HW-UNVERIFIED`: `/finity escalations approve` signing a MandateAmendment on a physical device (`compileAmendment` typed data is verified against `contracts/test/MandateRegistry.ts`; the device round-trip itself is not).
- `HW-UNVERIFIED`: `finity-verify` run against a real deployed `MandateRegistry`, a real mirror node, and a real settlement transaction ID. Every check it performs is verified with real cryptographic signatures against injected fakes (`packages/verifier`), but never against live infrastructure.
