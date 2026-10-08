// Phase 4 gate: every balance is in exactly one bucket — under the user's key on HL, inside a recorded
// bridge operation, a known residual, or manual recovery. Anything else is reported as unaccounted.
import type { FundingView } from "./bridge/funding";
import type { ReturnRecord, ReturnView } from "./bridge/returns";
import { UNIT_ZEC_MIN_ZAT } from "./bridge/unit";
import { toZatFloor } from "./bridge/returns";

export type Bucket = "user_control" | "bridge_operation" | "residual" | "manual_recovery" | "unaccounted";
export interface Line { bucket: Bucket; asset: string; amount: string; note: string }

export interface AccountingInput {
  perpsAccountValue: string;
  spot: { coin: string; token: number; total: string; hold: string }[];
  unitTokenIndex: number | null;
  funding?: FundingView | null;
  ret?: { rec: ReturnRecord; view: ReturnView } | null;
}

const HL_MIN_ORDER_USDC = 10;

export function accountBalances(i: AccountingInput): Line[] {
  const lines: Line[] = [];
  if (Number(i.perpsAccountValue) > 0) lines.push({ bucket: "user_control", asset: "USDC (perps)", amount: i.perpsAccountValue, note: "Perps account value under your key; includes open positions' PnL" });

  for (const b of i.spot) {
    if (!(Number(b.total) > 0)) continue;
    const isUnit = b.token === i.unitTokenIndex;
    if (isUnit && toZatFloor(b.total) < UNIT_ZEC_MIN_ZAT) {
      lines.push({ bucket: "residual", asset: b.coin, amount: b.total, note: "Below the 0.07 ZEC Unit minimum: cannot return as ZEC on its own; stays under your key" });
    } else if (!isUnit && b.coin === "USDC" && Number(b.total) < HL_MIN_ORDER_USDC) {
      lines.push({ bucket: "residual", asset: "USDC (spot)", amount: b.total, note: "Below HL's 10 USDC order minimum: cannot be converted; stays under your key" });
    } else {
      lines.push({ bucket: "user_control", asset: `${b.coin} (spot)`, amount: b.total, note: Number(b.hold) ? `${b.hold} on hold in open orders` : "Spot balance under your key" });
    }
  }

  const f = i.funding;
  if (f && ["deposit_seen", "bridge_pending"].includes(f.state)) {
    for (const op of f.operations) lines.push({ bucket: "bridge_operation", asset: "ZEC (inbound)", amount: zat(op.sourceAmount), note: `Unit op ${op.operationId}: ${op.state}` });
  }
  if (f && ["below_minimum_stuck", "manual_recovery"].includes(f.state)) {
    for (const op of f.operations) lines.push({ bucket: "manual_recovery", asset: "ZEC (inbound)", amount: zat(op.sourceAmount), note: `${f.state}: ${op.state}` });
  }

  const r = i.ret;
  if (r?.rec.send) {
    const s = r.rec.send;
    const amt = s.amount;
    if (r.view.state === "outcome_unknown") lines.push({ bucket: "unaccounted", asset: "Unit ZEC (return send)", amount: amt, note: "Send outcome unknown: reconcile. Either it is still in your spot balance or it reached Unit" });
    else if (r.view.state === "bridge_return_pending") lines.push({ bucket: "bridge_operation", asset: "Unit ZEC (return)", amount: amt, note: `Sent to verified Unit address ${s.destination}${s.hash ? `, HL tx ${s.hash}` : ""}` });
    else if (r.view.state === "manual_recovery") lines.push({ bucket: "manual_recovery", asset: "Unit ZEC (return)", amount: amt, note: "Unit reports a problem with the return; see RUNBOOK" });
    else if (["delivered_transparent", "user_marked_shielded", "wallet_confirmed_shielded"].includes(r.view.state)) {
      lines.push({ bucket: "user_control", asset: "ZEC (Zcash wallet)", amount: amt, note: `${r.view.state.replace(/_/g, " ")} at ${r.rec.route.destination} (gross; Unit's outbound fee deducted)` });
    }
  }
  return lines;
}

const zat = (s?: string) => (s && /^\d+$/.test(s) ? (Number(s) / 1e8).toString() : s ?? "?");

export const fullyAccounted = (lines: Line[]) => lines.every((l) => l.bucket !== "unaccounted");
