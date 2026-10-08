// Development-only fixtures for the return screen. Every one is labelled REPLAY in the UI and none
// represents a transfer of funds. Production mode must never use these as evidence.
import type { ReturnEvidence } from "../bridge/return-state";
import type { UnitOperation } from "../bridge/unit";

const op = (state: string, extra: Partial<UnitOperation> = {}): UnitOperation => ({
  operationId: "replay-withdraw-1",
  protocolAddress: "0x4E6091f91c8174466337E09F79b37056B150c3a1",
  sourceChain: "hyperliquid",
  destinationChain: "zcash",
  destinationAddress: "t1REPLAYFIXTUREONLYxxxxxxxxxxxxxxxxx",
  state,
  ...extra,
});
const tx = { destinationTxHash: "replaytxid0001" };

export interface ReturnScenarioDef { title: string; evidence: ReturnEvidence }

const defs = {
  below_minimum: { title: "Balance below the 0.07 ZEC return minimum", evidence: { tokenBalanceZat: 5_000_000n } },
  token_ready: { title: "Token ready to send", evidence: { tokenBalanceZat: 20_000_000n } },
  send_unknown: { title: "Send to Unit: outcome unknown", evidence: { tokenBalanceZat: 20_000_000n, transfer: { state: "unknown" } } },
  in_queue: { title: "Unit processing (withdraw queue)", evidence: { tokenBalanceZat: 0n, transfer: { state: "sent" }, withdrawalOp: op("readyForWithdrawQueue") } },
  delivered: { title: "Delivered as a transparent output", evidence: { tokenBalanceZat: 0n, transfer: { state: "sent" }, withdrawalOp: op("done", tx) } },
  marked: { title: "User ticked the shielded box", evidence: { tokenBalanceZat: 0n, withdrawalOp: op("done", tx), userMarkedShielded: true } },
  spent: { title: "Transparent output spent", evidence: { tokenBalanceZat: 0n, withdrawalOp: op("done", tx), transparentOutputSpentTxid: "replayspend0002" } },
  wallet_confirmed: {
    title: "Wallet-confirmed shielded",
    evidence: { tokenBalanceZat: 0n, withdrawalOp: op("done", tx), walletEvidence: { kind: "wallet", txid: "replayshield0003", confirmedAt: "2026-10-08T00:00:00Z" } },
  },
  unit_failure: { title: "Unit reports failure", evidence: { tokenBalanceZat: 0n, withdrawalOp: op("failure") } },
} satisfies Record<string, ReturnScenarioDef>;
export type ReturnScenario = keyof typeof defs;
export const RETURN_SCENARIOS: Record<ReturnScenario, ReturnScenarioDef> = defs;
