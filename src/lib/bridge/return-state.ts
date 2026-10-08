// Return-leg state derived only from evidence (PRD rule 10: show "confirmed" only with corresponding evidence).
// Pure function: a reload, a wiped local store or a provider error all reduce to the same answer.
import type { UnitOperation } from "./unit";
import type { OrderState } from "../hl/orders";
import type { TransferRecord } from "../hl/transfer";

export type ReturnState =
  | "account_ready"
  | "return_conversion_pending"
  | "return_token_ready"
  | "bridge_return_pending"
  | "delivered_transparent"
  | "shielding_pending"
  | "wallet_confirmed_shielded"
  | "outcome_unknown"
  | "recoverable_error"
  | "manual_recovery";

/** What we can honestly say about shielding. Only `wallet_confirmed` is proof the funds are shielded. */
export type ShieldingLabel = "not_started" | "you_marked_shielded" | "transparent_output_spent" | "wallet_confirmed";

export interface WalletShieldEvidence { kind: "wallet"; txid: string; confirmedAt: string }

export interface ReturnEvidence {
  /** Latest return-conversion order (USDC -> Unit token), if any. */
  conversionState?: OrderState;
  tokenBalanceZat: bigint | null;
  transfer?: Pick<TransferRecord, "state" | "error">;
  /** The Unit operation whose source is hyperliquid and destination zcash for this account. */
  withdrawalOp?: UnitOperation;
  userMarkedShielded?: boolean;
  transparentOutputSpentTxid?: string;
  walletEvidence?: WalletShieldEvidence;
}

export interface ReturnView { state: ReturnState; shielding: ShieldingLabel; explanation: string; destinationTxHash?: string }

// Withdrawal lifecycle (docs.hyperunit.xyz withdrawal-lifecycle). Unknown names are surfaced, never guessed.
const W_PENDING = new Set(["sourceTxDiscovered", "waitForSrcTxFinalization", "readyForWithdrawQueue", "queuedForWithdraw"]);

export function deriveReturn(e: ReturnEvidence): ReturnView {
  const op = e.withdrawalOp;
  const dest = op?.destinationTxHash;

  if (op?.state === "done" && dest) {
    if (e.walletEvidence) return { state: "wallet_confirmed_shielded", shielding: "wallet_confirmed", destinationTxHash: dest, explanation: `Your wallet reports the funds shielded (tx ${e.walletEvidence.txid}).` };
    const shielding: ShieldingLabel = e.transparentOutputSpentTxid ? "transparent_output_spent" : e.userMarkedShielded ? "you_marked_shielded" : "not_started";
    if (shielding === "not_started") return { state: "delivered_transparent", shielding, destinationTxHash: dest, explanation: "Delivered to your Zcash wallet as a transparent output. Open the wallet and shield it." };
    const why = shielding === "transparent_output_spent" ? `The transparent output was spent in ${e.transparentOutputSpentTxid}. That alone does not prove the funds arrived in your shielded account.` : "You marked this as shielded. Nothing has confirmed it.";
    return { state: "shielding_pending", shielding, destinationTxHash: dest, explanation: `${why} Check the shielded balance in your wallet.` };
  }
  const noShield = "not_started" as const;
  if (op && (op.state === "failure" || (!W_PENDING.has(op.state) && op.state !== "done"))) {
    return { state: "manual_recovery", shielding: noShield, explanation: `Unit reports withdrawal state "${op.state}". Keep this record; see RUNBOOK.` };
  }
  if (op?.state === "done" && !dest) {
    return { state: "bridge_return_pending", shielding: noShield, explanation: "Unit says done but has not reported the Zcash transaction yet. Not showing delivery until it does." };
  }
  if (e.transfer?.state === "pending" || e.transfer?.state === "unknown") {
    return { state: "outcome_unknown", shielding: noShield, explanation: "The send to Unit has an unknown outcome. Reconcile it against the Hyperliquid ledger. Do not send again." };
  }
  if (e.transfer?.state === "rejected") {
    return { state: "recoverable_error", shielding: noShield, explanation: `Hyperliquid rejected the send, so nothing left the account: ${e.transfer.error ?? "no detail"}.` };
  }
  if (op || e.transfer?.state === "sent") {
    return { state: "bridge_return_pending", shielding: noShield, explanation: op ? "Unit is processing the withdrawal (about 5,000 Hyperliquid confirmations, then the batch queue)." : "Sent to Unit. Waiting for Unit to discover the transfer." };
  }
  if (e.conversionState === "pending" || e.conversionState === "unknown" || e.conversionState === "partial" || e.conversionState === "resting") {
    return { state: "return_conversion_pending", shielding: noShield, explanation: "The conversion back to the Unit token is not complete. Re-read balances before continuing." };
  }
  if (e.tokenBalanceZat !== null && e.tokenBalanceZat > 0n) {
    return { state: "return_token_ready", shielding: noShield, explanation: "The Unit ZEC token is in the trading account and can be sent to Unit." };
  }
  return { state: "account_ready", shielding: noShield, explanation: "No Unit ZEC token to return." };
}
