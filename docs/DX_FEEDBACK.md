# Ledger developer experience feedback

Evidence collection starts after physical hardware is available. Each entry will include observed behavior, expected behavior, suggested fix, and a source URL.

## Current observations

- `wallet-cli` 2.1.0 exposes Key Ring initialization only through a device-required `ring init`; the CLI has no explicit enrollment/export/import command for a second host.
- The exact cross-host recovery path is not safe to infer without testing the Ledger Sync/LKRP user flow.

