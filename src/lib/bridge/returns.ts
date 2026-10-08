// Return lane: Unit ZEC token on HL -> Unit withdrawal address -> user's transparent Zcash address.
// Every step is evidence-labelled. The send is journaled before signing and never retried automatically;
// an unknown outcome is reconciled from the HL ledger (by nonce) before anything else may be sent.
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import { verifyDepositAddressSignatures, type Network, type VerificationResult } from "./guardians";
import { UNIT_API, UNIT_ZEC_MIN_ZAT, type EvidenceSource, type UnitOperation, type ZcashFees } from "./unit";
import { opPhase } from "./funding";
import { formatZecAmount, parseZcashAddress } from "../zcash/address";

export interface VerifiedReturnRoute {
  source: EvidenceSource;
  network: Network;
  /** User's Zcash destination, exactly as entered. */
  destination: string;
  /** HL address Unit returned: the spotSend destination. */
  unitHlAddress: `0x${string}`;
  verification: VerificationResult;
}

/**
 * Unit pays out to transparent addresses. Only P2PKH is accepted: it is what was verified live
 * (7 Oct, mainnet t1 and testnet tm). TEX, P2SH and shielded destinations are refused rather than guessed.
 */
export function checkReturnDestination(raw: string, network: Network): { ok: true } | { ok: false; reason: string } {
  let a;
  try { a = parseZcashAddress(raw); } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  if (a.network !== network) return { ok: false, reason: `This is a ${a.network} address; the return route is on ${network}` };
  if (a.kind !== "p2pkh") return { ok: false, reason: `Unit returns to a transparent address (${network === "mainnet" ? "t1…" : "tm…"}). Get a fresh transparent receive address from your Zcash wallet; ${a.kind} is not accepted here.` };
  return { ok: true };
}

/**
 * Withdrawal responses are signed with the "user-<coinType>-<dstChain>-<dst>-<address>" payload where
 * coinType is "ethereum" (the source is an EVM-style HL address). Found by probe 7 Oct; see scripts/probe-withdraw.ts.
 */
export async function verifyWithdrawalResponse(
  network: Network, destination: string, res: { address?: unknown; signatures?: unknown }, source: EvidenceSource = "unit-live",
): Promise<VerifiedReturnRoute> {
  const d = checkReturnDestination(destination, network);
  if (!d.ok) throw new Error(d.reason);
  if (typeof res.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(res.address) || typeof res.signatures !== "object" || !res.signatures) {
    throw new Error("Malformed Unit withdrawal response");
  }
  const verification = await verifyDepositAddressSignatures(network, res.signatures as Record<string, string>, {
    destinationAddress: destination, destinationChain: "zcash", asset: "zec", address: res.address, sourceChain: "hyperliquid", coinType: "ethereum",
  });
  if (!verification.success) throw new Error(`Guardian verification failed (${verification.verifiedCount} of 3 valid, need 2)`);
  return { source, network, destination, unitHlAddress: res.address as `0x${string}`, verification };
}

export async function generateReturnRoute(network: Network, destination: string): Promise<VerifiedReturnRoute> {
  const d = checkReturnDestination(destination, network);
  if (!d.ok) throw new Error(d.reason);
  const r = await fetch(`${UNIT_API[network]}/gen/hyperliquid/zcash/zec/${destination}`, { cache: "no-store" });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Unit ${r.status}: ${JSON.stringify(body)}`);
  return verifyWithdrawalResponse(network, destination, body);
}

// ---------- amounts ----------

/** Decimal string -> zatoshis, truncating (never rounding up) past `decimals` (<= 8). */
export function toZatFloor(amount: string, decimals = 8): bigint {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(amount.trim());
  if (!m) throw new Error(`Bad amount ${amount}`);
  const frac = (m[2] ?? "").slice(0, Math.min(decimals, 8)).padEnd(8, "0");
  return BigInt(m[1]) * 100_000_000n + BigInt(frac);
}

export type ReturnPlan =
  | { ok: true; sendAmount: string; sendZat: bigint; estNetZat: bigint; withdrawalFeeZat: bigint }
  | { ok: false; kind: "below_minimum" | "nothing_to_send" | "fee_exceeds"; residualZat: bigint; reason: string };

/**
 * What can go back as ZEC. `available` is the token's spot total minus hold, as HL reports it.
 * The 0.07 ZEC minimum is documented for deposits; Unit has not confirmed it for returns, so it is applied
 * conservatively here (sending less than a Unit minimum risks the same "stuck" outcome as a short deposit).
 */
export function planReturn(available: string, weiDecimals: number, fees: ZcashFees, minZat = UNIT_ZEC_MIN_ZAT): ReturnPlan {
  const sendZat = toZatFloor(available, weiDecimals);
  const withdrawalFeeZat = fees.withdrawalFeeZat;
  if (sendZat <= 0n) return { ok: false, kind: "nothing_to_send", residualZat: 0n, reason: "No Unit ZEC available to return." };
  if (sendZat < minZat) {
    return { ok: false, kind: "below_minimum", residualZat: sendZat, reason: `${formatZecAmount(sendZat)} ZEC is below the 0.07 ZEC Unit minimum. Sending it risks it getting stuck, so it is not offered.` };
  }
  if (sendZat <= withdrawalFeeZat) return { ok: false, kind: "fee_exceeds", residualZat: sendZat, reason: "The outbound fee is larger than the amount." };
  return { ok: true, sendAmount: formatZecAmount(sendZat), sendZat, estNetZat: sendZat - withdrawalFeeZat, withdrawalFeeZat };
}

/** Documented options for funds that cannot return as ZEC. Only tested routes are described as working. */
export function residualOptions(p: { residualZat: bigint; usdcAvailable: number; zecPx: number | null }): string[] {
  const out = [
    "The residual stays in your Hyperliquid account under your key. Nothing is lost; the recovery client can read it and you can sell or send it later.",
  ];
  if (p.zecPx && p.residualZat > 0n) {
    const shortZec = Number(UNIT_ZEC_MIN_ZAT - p.residualZat) / 1e8;
    const needUsdc = Math.max(10, shortZec * p.zecPx * 1.02);
    out.push(p.usdcAvailable >= needUsdc
      ? `Top up: buy at least ${shortZec.toFixed(8)} more Unit ZEC (an order of ≥ ${needUsdc.toFixed(2)} USDC; HL's 10 USDC order minimum applies), then return the total.`
      : `Top up needs ≥ ${needUsdc.toFixed(2)} USDC (HL's 10 USDC order minimum applies); you have ${p.usdcAvailable.toFixed(2)}.`);
  }
  out.push("Withdrawing USDC from Hyperliquid by another route (e.g. the HL bridge) is NOT tested by this app and would leave the Zcash return path; it is not offered as working.");
  return out;
}

// ---------- the send and its evidence ----------

export type SendState = "pending" | "unknown" | "sent" | "rejected" | "not_landed";
/** User-signed actions carry no expiry; we wait this long without a ledger entry before declaring not landed. */
export const SEND_NOT_LANDED_AFTER_MS = 10 * 60_000;

export interface ReturnSend {
  token: string; // spotSend selector "NAME:0xtokenId"
  amount: string;
  destination: `0x${string}`; // the verified Unit HL address
  nonceFloor: number; // the signed nonce is >= this (journaled before signing)
  nonce?: number;
  hash?: string;
  state: SendState;
  error?: string;
  evidence?: "exchange_response" | "reconciled_ledger";
  createdAt: string;
  updatedAt: string;
}

export type ShieldingStatus =
  | "not_delivered"
  | "delivered_transparent"
  | "user_marked_shielded" // a user tick only
  | "transparent_output_spent" // chain evidence of a spend; not proof of shielding
  | "wallet_confirmed_shielded"; // needs wallet evidence; no integration exists yet

export interface ReturnRecord {
  network: Network;
  hlAddress: string;
  source: EvidenceSource;
  route: VerifiedReturnRoute;
  send?: ReturnSend;
  operations: Record<string, UnitOperation>;
  shielding: ShieldingStatus;
  lastPollOk?: string;
  lastPollError?: { at: string; message: string };
}

export type ReturnState =
  | "return_token_ready" | "send_pending" | "outcome_unknown" | "recoverable_error"
  | "bridge_return_pending" | "delivered_transparent" | "user_marked_shielded"
  | "wallet_confirmed_shielded" | "manual_recovery";

export interface ReturnView { state: ReturnState; maySend: boolean; stale: boolean; operations: UnitOperation[]; explanation: string }

const now = () => new Date().toISOString();

export interface SpotSendApi { spotSend(p: { destination: `0x${string}`; token: string; amount: string }): Promise<any> }
export interface LedgerApi { userNonFundingLedgerUpdates(p: { user: `0x${string}`; startTime?: number }): Promise<any[]> }
export type Persist = (r: ReturnRecord) => void;

export class SendBlockedError extends Error {
  constructor(s: ReturnSend) { super(`A return send (${s.amount} ${s.token}) is ${s.state}. Reconcile it before sending again.`); }
}

/** HL accepts a signed action for up to ~2 days, so look back that far for sends local state may have lost. */
export const LEDGER_LOOKBACK_MS = 2 * 24 * 3600_000;

/**
 * Local storage can be cleared mid-send, losing the pending marker. Before any send, the HL ledger is the
 * authority: an earlier send to this Unit address that the local record does not know about blocks a new one.
 */
export async function priorSendsTo(api: LedgerApi, user: string, unitHlAddress: string, nowMs = Date.now()) {
  const updates = await api.userNonFundingLedgerUpdates({ user: user as `0x${string}`, startTime: nowMs - LEDGER_LOOKBACK_MS });
  return updates.filter((u) => u.delta?.type === "spotTransfer" && String(u.delta.destination).toLowerCase() === unitHlAddress.toLowerCase());
}

export class UnrecordedSendError extends Error {
  constructor(public hashes: string[]) { super(`Hyperliquid already shows a send to this Unit address that this browser has no record of (${hashes.join(", ")}). It is probably in the bridge: check Unit operations before sending again.`); }
}

/** Sign and send once. The ledger is checked first; the pending record is persisted before the network call. */
export async function submitReturnSend(api: SpotSendApi & LedgerApi, rec: ReturnRecord, persist: Persist, p: { token: string; amount: string }): Promise<ReturnRecord> {
  if (rec.send && rec.send.state !== "rejected" && rec.send.state !== "not_landed") throw new SendBlockedError(rec.send);
  const prior = (await priorSendsTo(api, rec.hlAddress, rec.route.unitHlAddress)).filter((u) => u.hash !== rec.send?.hash);
  if (prior.length) throw new UnrecordedSendError(prior.map((u) => u.hash));
  const send: ReturnSend = { token: p.token, amount: p.amount, destination: rec.route.unitHlAddress, nonceFloor: Date.now(), state: "pending", createdAt: now(), updatedAt: now() };
  let out: ReturnRecord = { ...rec, send };
  persist(out);
  try {
    await api.spotSend({ destination: send.destination, token: send.token, amount: send.amount });
    out = { ...out, send: { ...send, state: "sent", evidence: "exchange_response", updatedAt: now() } };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // An ApiRequestError is HL answering "no"; anything else may have landed.
    const definitive = e instanceof ApiRequestError;
    out = { ...out, send: { ...send, state: definitive ? "rejected" : "unknown", error, updatedAt: now() } };
  }
  persist(out);
  return out;
}

/** Look for the send in HL's ledger. Matching is by destination, token, amount and nonce >= the journaled floor. */
export async function reconcileReturnSend(api: LedgerApi, rec: ReturnRecord, persist: Persist, nowMs = Date.now()): Promise<ReturnRecord> {
  const s = rec.send;
  if (!s) return rec;
  const updates = await api.userNonFundingLedgerUpdates({ user: rec.hlAddress as `0x${string}`, startTime: s.nonceFloor - 60_000 });
  const tokenName = s.token.split(":")[0];
  const hit = updates.find((u) => {
    const d = u.delta ?? {};
    return d.type === "spotTransfer" && String(d.destination).toLowerCase() === s.destination.toLowerCase()
      && d.token === tokenName && Number(d.amount) === Number(s.amount) && (d.nonce == null || d.nonce >= s.nonceFloor);
  });
  let next: ReturnSend;
  if (hit) next = { ...s, state: "sent", hash: hit.hash, nonce: hit.delta.nonce ?? undefined, evidence: "reconciled_ledger", error: undefined };
  else if (s.state === "sent") next = s; // exchange said ok; ledger lag is not a reason to downgrade
  else if (nowMs - s.nonceFloor < SEND_NOT_LANDED_AFTER_MS) next = { ...s, state: "unknown", error: `Not in the ledger yet; earliest "not landed" verdict ${new Date(s.nonceFloor + SEND_NOT_LANDED_AFTER_MS).toISOString()}` };
  else next = { ...s, state: "not_landed", evidence: "reconciled_ledger" };
  const out = { ...rec, send: { ...next, updatedAt: now() } };
  persist(out);
  return out;
}

const isReturnOp = (op: UnitOperation, rec: ReturnRecord) =>
  op.sourceChain === "hyperliquid" && op.destinationChain === "zcash" && op.destinationAddress === rec.route.destination;

export function mergeReturnOperations(rec: ReturnRecord, ops: UnitOperation[], at = now()): ReturnRecord {
  const next = { ...rec.operations };
  for (const op of ops.filter((o) => isReturnOp(o, rec))) next[op.operationId] = op;
  return { ...rec, operations: next, lastPollOk: at, lastPollError: undefined };
}

export function deriveReturn(rec: ReturnRecord): ReturnView {
  const operations = Object.values(rec.operations).sort((a, b) => String(a.opCreatedAt).localeCompare(String(b.opCreatedAt)));
  const stale = !!rec.lastPollError;
  const v = (state: ReturnState, explanation: string, maySend = false): ReturnView => ({ state, explanation, maySend, stale, operations });
  const s = rec.send;
  if (!s || s.state === "not_landed") {
    return v("return_token_ready", s ? "The earlier send never reached Hyperliquid (checked against the ledger). You may send again." : "Route verified. Nothing has been sent.", true);
  }
  if (s.state === "rejected") return v("recoverable_error", `Hyperliquid rejected the send: ${s.error}. Nothing left your account.`, true);
  if (s.state === "pending") return v("outcome_unknown", "A send was started but its result was not recorded (closed tab or crash). Reconcile before anything else.");
  if (s.state === "unknown") return v("outcome_unknown", `The send's outcome is unknown (${s.error}). Do not send again; reconcile against the Hyperliquid ledger.`);
  // sent
  const phases = operations.map(opPhase);
  if (phases.some((p) => p === "failed" || p === "unknown" || p === "below_minimum")) {
    return v("manual_recovery", `Unit reports "${operations.find((o) => opPhase(o) !== "done" && opPhase(o) !== "pending" && opPhase(o) !== "seen")!.state}". Keep this record and follow docs/RUNBOOK.md.`);
  }
  const done = operations.find((o) => opPhase(o) === "done" && o.destinationTxHash);
  if (done) {
    if (rec.shielding === "wallet_confirmed_shielded") return v("wallet_confirmed_shielded", "Your wallet confirmed the funds are shielded.");
    if (rec.shielding === "user_marked_shielded") return v("user_marked_shielded", "You marked this shielded. This app has no wallet evidence of it.");
    return v("delivered_transparent", `Delivered to your Zcash wallet (tx ${done.destinationTxHash}) — open the wallet and shield.`);
  }
  if (operations.length === 0) {
    return v("bridge_return_pending", stale ? "Sent on Hyperliquid; Unit cannot be reached right now. Nothing is lost; do not send again." : "Sent on Hyperliquid; waiting for Unit to pick it up.");
  }
  return v("bridge_return_pending", "Unit is processing the return. Live estimates were about two hours; do not send again.");
}

/** Shielding statuses only move forward on the evidence each one names. */
export function markShielding(rec: ReturnRecord, to: "user_marked_shielded"): ReturnRecord {
  if (deriveReturn(rec).state !== "delivered_transparent") throw new Error("Only a delivered return can be marked shielded");
  return { ...rec, shielding: to };
}
