import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import { AccountBusyError, OrderBlockedError, OrderLedger, notLandedAfter, persistentNonceManager, reconcileOrder, submitIoc, type IocRequest } from "./orders";

const ACC = "0x1f20B96A9fde5218ED05A212B2d23093100785c0" as const;
const memKv = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const REQ: IocRequest = { label: "BTC open", asset: 3, isBuy: true, size: "0.002", px: "70000" };
const ok = (st: unknown) => ({ order: async () => ({ response: { data: { statuses: [st] } } }) });

// Exchange that records every order it receives: lets us count actual submissions.
function exchange(behaviour: (n: number, p: any) => Promise<any>) {
  const sent: any[] = [];
  return { sent, order: async (p: any) => { sent.push(p); return behaviour(sent.length, p); } };
}

describe("submitIoc outcomes", () => {
  it("full fill", async () => {
    const r = await submitIoc(ok({ filled: { totalSz: "0.002", avgPx: "69990", oid: 1 } }), new OrderLedger(memKv(), "testnet", ACC), "testnet", ACC, REQ);
    expect(r).toMatchObject({ state: "filled", filledSz: "0.002", evidence: "exchange_response" });
  });
  it("partial IOC fill is recorded as partial with the actual size, not the requested size", async () => {
    const r = await submitIoc(ok({ filled: { totalSz: "0.0007", avgPx: "69990", oid: 1 } }), new OrderLedger(memKv(), "testnet", ACC), "testnet", ACC, REQ);
    expect(r).toMatchObject({ state: "partial", filledSz: "0.0007", size: "0.002" });
  });
  it("exchange rejection (ApiRequestError) is final and does not block", async () => {
    const ledger = new OrderLedger(memKv(), "testnet", ACC);
    const r = await submitIoc({ order: async () => { throw new ApiRequestError({}, "Order could not immediately match"); } }, ledger, "testnet", ACC, REQ);
    expect(r.state).toBe("rejected");
    expect(ledger.blocking()).toBeUndefined();
  });
  it("signs every order with an expiresAfter deadline", async () => {
    const ex = { opts: undefined as any, order: async (_p: any, o: any) => { ex.opts = o; return { response: { data: { statuses: [{ error: "x" }] } } }; } };
    const r = await submitIoc(ex, new OrderLedger(memKv(), "testnet", ACC), "testnet", ACC, REQ);
    expect(ex.opts.expiresAfter).toBe(r.expiresAt);
    expect(r.expiresAt! - Date.now()).toBeGreaterThan(10_000);
  });
  it("journals the cloid as pending before the request leaves", async () => {
    const ledger = new OrderLedger(memKv(), "testnet", ACC);
    let seen: string | undefined;
    await submitIoc({ order: async (p: any) => { seen = ledger.get(p.orders[0].c)?.state; return { response: { data: { statuses: [{ filled: { totalSz: "0.002", avgPx: "1", oid: 1 } }] } } }; } }, ledger, "testnet", ACC, REQ);
    expect(seen).toBe("pending");
  });
});

describe("unknown outcomes cannot create duplicate exposure", () => {
  it("timeout after submission -> unknown -> next order blocked, even after reload", async () => {
    const kv = memKv();
    const ex = exchange(async () => { throw new Error("The operation timed out"); });
    const r = await submitIoc(ex, new OrderLedger(kv, "testnet", ACC), "testnet", ACC, REQ);
    expect(r.state).toBe("unknown");
    const reloaded = new OrderLedger(kv, "testnet", ACC); // same storage, new instance
    await expect(submitIoc(ex, reloaded, "testnet", ACC, REQ)).rejects.toBeInstanceOf(OrderBlockedError);
    expect(ex.sent).toHaveLength(1);
  });

  it("an unresolved order never blocks a reduce-only close", async () => {
    const ledger = new OrderLedger(memKv(), "testnet", ACC);
    await submitIoc(exchange(async () => { throw new Error("timeout"); }), ledger, "testnet", ACC, REQ);
    const close = await submitIoc(ok({ filled: { totalSz: "0.002", avgPx: "1", oid: 2 } }), ledger, "testnet", ACC, { ...REQ, isBuy: false, reduceOnly: true });
    expect(close.state).toBe("filled");
  });

  it("crash between journal and response (stale pending) also blocks", async () => {
    const kv = memKv();
    const ledger = new OrderLedger(kv, "testnet", ACC);
    ledger.put({ cloid: "0x" + "ab".repeat(16) as `0x${string}`, network: "testnet", account: ACC, label: "x", asset: 3, isBuy: true, size: "1", px: "1", reduceOnly: false, state: "pending", createdAt: "", updatedAt: "" });
    const ex = exchange(async () => ({}));
    await expect(submitIoc(ex, ledger, "testnet", ACC, REQ)).rejects.toBeInstanceOf(OrderBlockedError);
    expect(ex.sent).toHaveLength(0);
  });

  it("reconcile finds the order filled: no retry is needed and the block clears", async () => {
    const kv = memKv(); const ledger = new OrderLedger(kv, "testnet", ACC);
    const r = await submitIoc(exchange(async () => { throw new Error("fetch failed"); }), ledger, "testnet", ACC, REQ);
    const status = {
      orderStatus: async () => ({ status: "order", order: { status: "filled", order: { oid: 9, origSz: "0.002", sz: "0" } } }),
      userFills: async () => [{ cloid: r.cloid, sz: "0.0015", px: "70000", oid: 9 }, { cloid: r.cloid, sz: "0.0005", px: "70010", oid: 9 }, { cloid: "0xother", sz: "5", px: "1", oid: 1 }],
    };
    const done = await reconcileOrder(status, ledger, ACC, r.cloid);
    expect(done).toMatchObject({ state: "filled", filledSz: "0.002", evidence: "reconciled_order_status" });
    expect(Number(done.avgPx)).toBeCloseTo(70002.5);
    expect(ledger.blocking()).toBeUndefined();
  });

  it("reconcile: IOC canceled after a partial fill is partial; unknownOid with no fills is not_landed", async () => {
    const ledger = new OrderLedger(memKv(), "testnet", ACC);
    const a = await submitIoc(exchange(async () => { throw new Error("timeout"); }), ledger, "testnet", ACC, REQ);
    const p = await reconcileOrder({
      orderStatus: async () => ({ status: "order", order: { status: "canceled", order: { oid: 4, origSz: "0.002", sz: "0.0012" } } }),
      userFills: async () => [{ cloid: a.cloid, sz: "0.0008", px: "70000", oid: 4 }],
    }, ledger, ACC, a.cloid);
    expect(p).toMatchObject({ state: "partial", filledSz: "0.0008" });

    const b = await submitIoc(exchange(async () => { throw new Error("timeout"); }), ledger, "testnet", ACC, REQ);
    const none = { orderStatus: async () => ({ status: "unknownOid" }), userFills: async () => [] };
    // Seen live: right after submission HL info still says unknownOid for an order that DID fill.
    const early = await reconcileOrder(none, ledger, ACC, b.cloid, Date.now() + 1_000);
    expect(early.state).toBe("unknown");
    expect(ledger.blocking()?.cloid).toBe(b.cloid);
    const n = await reconcileOrder(none, ledger, ACC, b.cloid, notLandedAfter(early));
    expect(n.state).toBe("not_landed");
    expect(ledger.blocking()).toBeUndefined();
  });

  it("duplicate click while the first is in flight is refused without sending", async () => {
    let release!: () => void;
    const ex = exchange(() => new Promise((res) => { release = () => res({ response: { data: { statuses: [{ filled: { totalSz: "0.002", avgPx: "1", oid: 1 } }] } } }); }));
    const ledger = new OrderLedger(memKv(), "testnet", ACC);
    const first = submitIoc(ex, ledger, "testnet", ACC, REQ);
    await expect(submitIoc(ex, ledger, "testnet", ACC, REQ)).rejects.toBeInstanceOf(AccountBusyError);
    await Promise.resolve(); release();
    expect((await first).state).toBe("filled");
    expect(ex.sent).toHaveLength(1);
  });

  it("ledgers are per account and per network", () => {
    const kv = memKv();
    new OrderLedger(kv, "testnet", ACC).put({ cloid: "0x01", network: "testnet", account: ACC, label: "", asset: 0, isBuy: true, size: "1", px: "1", reduceOnly: false, state: "unknown", createdAt: "", updatedAt: "" } as any);
    expect(new OrderLedger(kv, "mainnet", ACC).blocking()).toBeUndefined();
    expect(new OrderLedger(kv, "testnet", "0x" + "1".repeat(40)).blocking()).toBeUndefined();
  });
});

describe("nonces", () => {
  it("are strictly increasing per account and survive a reload", () => {
    const kv = memKv();
    const a = persistentNonceManager(kv);
    const xs = [a(ACC), a(ACC), a(ACC)];
    const b = persistentNonceManager(kv); // reload
    xs.push(b(ACC));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });
});
