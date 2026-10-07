// Funding state derived only from evidence: Unit operations plus the HL token balance.
// Pure functions so reload, provider errors and duplicate reads all reduce the same way.
import type { EvidenceSource, UnitOperation } from "./unit";

export type FundingState =
  | "awaiting_deposit"
  | "deposit_seen"
  | "bridge_pending"
  | "unit_token_received"
  | "below_minimum_stuck"
  | "recoverable_error"
  | "manual_recovery";

export interface FundingRecord {
  /** Persisted nonsecret mapping and every operation ever observed, keyed by source tx identity. */
  network: "testnet" | "mainnet";
  hlAddress: string;
  payAddress: string;
  source: EvidenceSource;
  operations: Record<string, UnitOperation>;
  lastPollOk?: string;
  lastPollError?: { at: string; message: string };
}

export interface FundingView {
  state: FundingState;
  /** Never true once any deposit is observed or polling is failing. */
  mayShowPaymentRequest: boolean;
  stale: boolean;
  operations: UnitOperation[];
  explanation: string;
}

/** Deposit identity is the Zcash source transaction (and output), not Unit's polling result. */
export const depositKey = (op: UnitOperation) => op.sourceTxHash || `op:${op.operationId}`;

const isZecDeposit = (op: UnitOperation, rec: FundingRecord) =>
  op.sourceChain === "zcash" && op.destinationChain === "hyperliquid" && op.destinationAddress.toLowerCase() === rec.hlAddress.toLowerCase();

/** Merge a poll result. Operations are never dropped because a later read omitted them. */
export function mergeOperations(rec: FundingRecord, ops: UnitOperation[], at = new Date().toISOString()): FundingRecord {
  const next = { ...rec.operations };
  for (const op of ops.filter((o) => isZecDeposit(o, rec))) next[depositKey(op)] = op;
  return { ...rec, operations: next, lastPollOk: at, lastPollError: undefined };
}

export function recordPollError(rec: FundingRecord, message: string, at = new Date().toISOString()): FundingRecord {
  return { ...rec, lastPollError: { at, message } };
}

// Unit deposit lifecycle states (docs.hyperunit.xyz operations). Unknown ones are surfaced raw.
const SEEN = new Set(["sourceTxDiscovered"]);
const PENDING = new Set(["waitForSrcTxFinalization", "buildingDstTx", "additionalChecks", "signTx", "broadcastTx", "waitForDstTxFinalization"]);
const DONE = new Set(["done"]);
const FAILED = new Set(["failure"]);

export function opPhase(op: UnitOperation): "seen" | "pending" | "done" | "failed" | "below_minimum" | "unknown" {
  if (/minimum|too.?small|below/i.test(String(op.state)) || /minimum/i.test(String(op.error ?? ""))) return "below_minimum";
  if (SEEN.has(op.state)) return "seen";
  if (PENDING.has(op.state)) return "pending";
  if (DONE.has(op.state)) return "done";
  if (FAILED.has(op.state)) return "failed";
  return "unknown";
}

/**
 * Derive the view. `tokenBalance` is the official Unit ZEC spot balance on HL (null if unread).
 * "unit_token_received" requires both a done operation and a positive balance.
 */
export function deriveFunding(rec: FundingRecord, tokenBalance: number | null): FundingView {
  const operations = Object.values(rec.operations).sort((a, b) => String(a.opCreatedAt).localeCompare(String(b.opCreatedAt)));
  const stale = !!rec.lastPollError;
  const phases = operations.map(opPhase);
  const base = { operations, stale };

  if (operations.length === 0) {
    if (stale) return { ...base, state: "recoverable_error", mayShowPaymentRequest: false, explanation: "Cannot reach Unit. If you already sent ZEC, do not send again; it will appear when Unit is reachable." };
    return { ...base, state: "awaiting_deposit", mayShowPaymentRequest: true, explanation: "No deposit observed yet." };
  }
  const b = { ...base, mayShowPaymentRequest: false };
  if (phases.includes("below_minimum")) return { ...b, state: "below_minimum_stuck", explanation: "A deposit was below Unit's minimum. Unit only reprocesses it if the minimum is lowered. Do not send again to top it up without checking with Unit." };
  if (phases.includes("failed") || phases.includes("unknown")) return { ...b, state: "manual_recovery", explanation: `Unit reports state "${operations.find((o) => ["failed", "unknown"].includes(opPhase(o)))!.state}". Keep this record; see RUNBOOK.` };
  if (phases.every((p) => p === "done")) {
    if (tokenBalance !== null && tokenBalance > 0) return { ...b, state: "unit_token_received", explanation: "Unit reports done and the ZEC token is in the trading account." };
    return { ...b, state: "bridge_pending", explanation: "Unit reports done; waiting to see the token balance on Hyperliquid." };
  }
  if (phases.includes("pending")) return { ...b, state: "bridge_pending", explanation: "Waiting for 100 Zcash confirmations (about 125 minutes), then Unit mints on Hyperliquid." };
  return { ...b, state: "deposit_seen", explanation: "Unit has seen your Zcash transaction." };
}
