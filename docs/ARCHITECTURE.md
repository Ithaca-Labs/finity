# Finity architecture

The target trust boundary is the one in `AGENTS.md`: Pi is the buyer-agent process, `finityd` is the deterministic broker, and `vault-worker` is the isolated secret and payment process. The Ledger signs authority (mandates, amendments, revocations); it does not sign individual x402 payments. The Broker Session Key is the Hedera Spend Account payer.

Detailed package responsibilities are defined by `FINITY_BUILD_SPEC.md` §7.2 and are implemented in later phase branches.

