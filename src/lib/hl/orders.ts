// Reliable IOC submission: every order is journaled under its client order id (cloid) BEFORE it is sent.
// An order whose outcome is unknown (or a "pending" left behind by a crash/reload) blocks any further
// order on that account until it is reconciled against HL order status and fills. Never auto-retried.
// Each order is signed with an `expiresAfter` deadline, so "not found" becomes definitive only once that
// deadline (plus a margin for info-API lag, observed at >1.5s on testnet) has passed.
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import type { Network } from "../bridge/guardians";
import { newCloid } from "./client";

export type Kv = Pick<Storage, "getItem" | "setItem">;
export type OrderState = "pending" | "unknown" | "filled" | "partial" | "resting" | "rejected" | "not_landed";
export const BLOCKING: readonly OrderState[] = ["pending", "unknown"];
export const ORDER_TTL_MS = 20_000; // exchange will not process the order after this
export const INFO_LAG_MS = 15_000; // extra wait before trusting "unknownOid"
const LEGACY_WAIT_MS = 5 * 60_000; // records without a signed deadline

export interface OrderRecord {
  cloid: `0x${string}`;
  network: Network;
  account: string;
  label: string; // e.g. "BTC perp open", "XZEC -> USDC"
  asset: number; // perp index or 10000 + spot market index
  isBuy: boolean;
  size: string;
  px: string;
  reduceOnly: boolean;
  builder?: { b: `0x${string}`; f: number };
  state: OrderState;
  filledSz?: string;
  avgPx?: string;
  oid?: number;
  error?: string;
  evidence?: "exchange_response" | "reconciled_order_status" | "reconciled_fills";
  expiresAt?: number; // signed expiresAfter (ms epoch)
  createdAt: string;
  updatedAt: string;
}

export class OrderLedger {
  private key: string;
  constructor(private kv: Kv | undefined, network: Network, account: string) {
    this.key = `orders:${network}:${account.toLowerCase()}`;
  }
  list(): OrderRecord[] {
    try { return JSON.parse(this.kv?.getItem(this.key) ?? "[]"); } catch { return []; }
  }
  get(cloid: string) { return this.list().find((r) => r.cloid === cloid); }
  put(rec: OrderRecord) {
    const all = this.list().filter((r) => r.cloid !== rec.cloid);
    all.unshift({ ...rec, updatedAt: new Date().toISOString() });
    this.kv?.setItem(this.key, JSON.stringify(all.slice(0, 200)));
  }
  /** First order that must be reconciled before anything new is sent on this account. */
  blocking() { return this.list().find((r) => BLOCKING.includes(r.state)); }
}

export class OrderBlockedError extends Error {
  constructor(public record: OrderRecord) {
    super(`Order ${record.cloid} (${record.label}) has an unknown outcome. Reconcile it before placing another order.`);
  }
}
export class AccountBusyError extends Error {
  constructor() { super("Another order on this account is being submitted (this tab or another). Wait for it to finish."); }
}

// In-tab lock, upgraded to a cross-tab Web Lock when the browser has one.
const held = new Set<string>();
export async function withAccountLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (held.has(key)) throw new AccountBusyError();
  held.add(key);
  try {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    if (!locks) return await fn();
    let ran = false;
    const out = await locks.request(`hl-order:${key}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return undefined;
      ran = true;
      return fn();
    });
    if (!ran) throw new AccountBusyError();
    return out as T;
  } finally { held.delete(key); }
}

/** Account-scoped nonce: max(now, last + 1), persisted so reloads and other tabs never reuse one. */
export function persistentNonceManager(kv: Kv | undefined) {
  const mem = new Map<string, number>();
  return (address: string) => {
    const key = `nonce:${address.toLowerCase()}`;
    const last = Math.max(mem.get(key) ?? 0, Number(kv?.getItem(key) ?? 0));
    const n = Math.max(Date.now(), last + 1);
    mem.set(key, n);
    kv?.setItem(key, String(n));
    return n;
  };
}

export interface OrderApi { order(p: any, opts?: any): Promise<any> }
export interface StatusApi {
  orderStatus(p: { user: `0x${string}`; oid: `0x${string}` | number }): Promise<any>;
  userFills(p: { user: `0x${string}` }): Promise<any[]>;
}

export interface IocRequest {
  label: string; asset: number; isBuy: boolean; size: string; px: string;
  reduceOnly?: boolean; builder?: { b: `0x${string}`; f: number };
}

const now = () => new Date().toISOString();

/** Submit one price-bounded IOC. Returns the journaled record; never throws after the pending record is written. */
export async function submitIoc(api: OrderApi, ledger: OrderLedger, network: Network, account: string, req: IocRequest): Promise<OrderRecord> {
  return withAccountLock(`${network}:${account.toLowerCase()}`, async () => {
    // Reduce-only cannot add exposure, so an unresolved order never blocks closing (PRD rule 7).
    const blocked = req.reduceOnly ? undefined : ledger.blocking();
    if (blocked) throw new OrderBlockedError(blocked);
    const rec: OrderRecord = {
      cloid: newCloid(), network, account, label: req.label, asset: req.asset, isBuy: req.isBuy,
      size: req.size, px: req.px, reduceOnly: req.reduceOnly ?? false, builder: req.builder,
      state: "pending", createdAt: now(), updatedAt: now(), expiresAt: Date.now() + ORDER_TTL_MS,
    };
    ledger.put(rec); // journaled before the network call
    try {
      const res = await api.order({
        orders: [{ a: rec.asset, b: rec.isBuy, p: rec.px, s: rec.size, r: rec.reduceOnly, t: { limit: { tif: "Ioc" } }, c: rec.cloid }],
        grouping: "na",
        ...(rec.builder ? { builder: rec.builder } : {}),
      }, { expiresAfter: rec.expiresAt });
      Object.assign(rec, fromStatus(res.response.data.statuses[0], rec.size), { evidence: "exchange_response" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // ApiRequestError = the exchange answered with a definitive rejection. Anything else
      // (timeout, network, 5xx) may have landed, so it is unknown until reconciled.
      Object.assign(rec, e instanceof ApiRequestError ? { state: "rejected", error: msg } : { state: "unknown", error: msg });
    }
    ledger.put(rec);
    return rec;
  });
}

function fromStatus(st: any, requested: string): Partial<OrderRecord> {
  if (st?.filled) {
    const partial = Number(st.filled.totalSz) < Number(requested);
    return { state: partial ? "partial" : "filled", filledSz: st.filled.totalSz, avgPx: st.filled.avgPx, oid: st.filled.oid };
  }
  if (st?.resting) return { state: "resting", oid: st.resting.oid };
  return { state: "rejected", error: st?.error ?? JSON.stringify(st) };
}

/** Resolve an unknown/pending order from HL's own records. Fills are the source of truth for size. */
/** Earliest time an order that HL reports as unknown may be declared not landed. */
export function notLandedAfter(rec: OrderRecord) {
  return (rec.expiresAt ?? Date.parse(rec.createdAt) + LEGACY_WAIT_MS) + INFO_LAG_MS;
}

export async function reconcileOrder(api: StatusApi, ledger: OrderLedger, user: `0x${string}`, cloid: `0x${string}`, nowMs = Date.now()): Promise<OrderRecord> {
  const rec = ledger.get(cloid);
  if (!rec) throw new Error(`No journaled order ${cloid}`);
  const [status, fills] = await Promise.all([api.orderStatus({ user, oid: cloid }), api.userFills({ user })]);
  const mine = fills.filter((f) => f.cloid === cloid);
  const sz = mine.reduce((s, f) => s + Number(f.sz), 0);
  const avg = sz > 0 ? mine.reduce((s, f) => s + Number(f.sz) * Number(f.px), 0) / sz : 0;
  const filled: Partial<OrderRecord> = sz > 0 ? { filledSz: String(sz), avgPx: String(avg), oid: mine[0].oid } : {};

  let next: Partial<OrderRecord>;
  if (status.status === "unknownOid") {
    if (sz > 0) next = { state: sz < Number(rec.size) ? "partial" : "filled", ...filled, evidence: "reconciled_fills" };
    else if (nowMs < notLandedAfter(rec)) {
      // Too early: the order may still be processed, or the info API may not show it yet.
      next = { state: "unknown", error: `Not visible yet; check again after ${new Date(notLandedAfter(rec)).toISOString()}` };
    } else next = { state: "not_landed", evidence: "reconciled_order_status" };
  } else {
    const s: string = status.order.status;
    const o = status.order.order;
    const oid = o.oid;
    // Fills may be outside userFills' window; fall back to origSz - remaining sz from the order itself.
    if (sz === 0 && Number(o.origSz) > Number(o.sz)) Object.assign(filled, { filledSz: String(Number(o.origSz) - Number(o.sz)) });
    if (s === "open") next = { state: "resting", oid, ...filled };
    else if (s === "filled") next = { state: "filled", oid, ...filled };
    else next = filled.filledSz ? { state: "partial", oid, ...filled } : { state: "rejected", oid, error: s };
    next.evidence = "reconciled_order_status";
  }
  const out = { ...rec, ...next } as OrderRecord;
  ledger.put(out);
  return out;
}
