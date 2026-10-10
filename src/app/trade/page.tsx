"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Network } from "@/lib/bridge/guardians";
import { createHl, formatPerpPrice, formatSize } from "@/lib/hl/client";
import { OrderBlockedError, OrderLedger, notLandedAfter, reconcileOrder, submitIoc, type OrderRecord } from "@/lib/hl/orders";
import { executeConversion, planConversion, resolveSpot, availableSpot, type ConversionPlan, type SpotMarket } from "@/lib/hl/spot";
import { approveBuilder, BUILDER_FEE, builderForOrder, builderStatus, needsClassTransfer, readAccountMode, type BuilderStatus } from "@/lib/hl/account";
import { UNIT_ZEC_TOKEN_ID } from "@/lib/hl/xzec";
import { useAccount } from "@/lib/account/use-account";
import { AccountPanel } from "../account-panel";

const NETWORK: Network = "testnet"; // ZEC perp is delisted on testnet; BTC/ETH only
const PERPS = ["BTC", "ETH"];
const BUILDER = process.env.NEXT_PUBLIC_BUILDER_ADDRESS as `0x${string}` | undefined;
const kv = () => { try { return window.localStorage; } catch { return undefined; } };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mono: React.CSSProperties = { fontFamily: "var(--font-mono), monospace", fontSize: 13 };

type Snapshot = {
  perps: any; spot: any[]; mode: string; openOrders: any[]; fills: any[]; mids: Record<string, string>;
  meta: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[]; takerRate: number; builder: BuilderStatus;
};

export default function Trade() {
  const acct = useAccount(NETWORK);
  const c = acct.clients;
  const canTrade = !!c;
  const user = (c?.address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const valid = !!c;
  // Orders are signed by the trading key (agent); transfers and approvals by the account key.
  const readOnly = useMemo(() => createHl(NETWORK), []);
  const hl = c?.trader ?? readOnly;
  const owner = c?.owner;
  const ledger = useMemo(() => new OrderLedger(kv(), NETWORK, user), [user]);

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!valid) return;
    try {
      const [perps, spot, mode, openOrders, fills, mids, meta, fees, builder] = await Promise.all([
        hl.info.clearinghouseState({ user }), hl.info.spotClearinghouseState({ user }), readAccountMode(hl, user),
        hl.info.openOrders({ user }), hl.info.userFills({ user }), hl.info.allMids(), hl.info.meta(), hl.info.userFees({ user }),
        builderStatus(hl, user, BUILDER),
      ]);
      setSnap({ perps, spot: spot.balances, mode, openOrders, fills: fills.slice(0, 15), mids, meta: meta.universe, takerRate: Number(fees.userCrossRate), builder });
    } catch (e) { setErr(`Read failed (showing last known state): ${msg(e)}`); }
    setOrders(ledger.list());
  }, [hl, user, valid, ledger]);

  useEffect(() => { setSnap(null); refresh(); const id = setInterval(refresh, 10_000); return () => clearInterval(id); }, [refresh]);

  async function act(fn: () => Promise<unknown>) {
    setErr(null); setBusy(true);
    try { await fn(); } catch (e) { setErr(e instanceof OrderBlockedError ? e.message : msg(e)); }
    finally { setBusy(false); refresh(); }
  }

  const blocking = orders.find((o) => o.state === "pending" || o.state === "unknown");

  // ---- perp order form ----
  const [coin, setCoin] = useState("BTC");
  const [side, setSide] = useState<"long" | "short">("long");
  const [usd, setUsd] = useState("15");
  const [lev, setLev] = useState("3");
  const [slip, setSlip] = useState("0.01");
  const [review, setReview] = useState(false);
  const m = snap?.meta.find((u) => u.name === coin);
  const assetIndex = snap?.meta.findIndex((u) => u.name === coin) ?? -1;
  const mid = Number(snap?.mids[coin] ?? 0);
  const size = m && mid ? formatSize(Number(usd) / mid, m.szDecimals) : "0";
  const notional = Number(size) * mid;
  const builderAttach = snap ? builderForOrder(snap.builder) : undefined;
  const feeRate = (snap?.takerRate ?? 0) + (builderAttach ? BUILDER_FEE.f / 1e5 : 0);
  const boundPx = m ? formatPerpPrice(mid * (side === "long" ? 1 + Number(slip) : 1 - Number(slip)), m.szDecimals) : "0";
  const levN = Math.max(1, Math.min(Number(lev) || 1, m?.maxLeverage ?? 1));
  const orderProblem = !canTrade ? "Create your account first" : !m || m.isDelisted ? `${coin} not tradable on ${NETWORK}`
    : Number(size) <= 0 ? "Size rounds to 0" : notional < 10 ? "Hyperliquid minimum order value is 10 USDC" : blocking ? "Reconcile the unknown order first" : null;

  const placeOrder = () => act(async () => {
    await acct.ensureTrading();
    await hl.exchange!.updateLeverage({ asset: assetIndex, isCross: true, leverage: levN });
    await submitIoc(hl.exchange!, ledger, NETWORK, user, {
      label: `${coin} ${side} open`, asset: assetIndex, isBuy: side === "long", size, px: boundPx, builder: builderAttach,
    });
    setReview(false);
  });

  const closePos = (p: any) => act(async () => {
    await acct.ensureTrading();
    const idx = snap!.meta.findIndex((u) => u.name === p.coin);
    const szi = Number(p.szi);
    const px = formatPerpPrice(Number(snap!.mids[p.coin]) * (szi < 0 ? 1.05 : 0.95), snap!.meta[idx].szDecimals);
    // No builder on closes: a revoked or failed approval must never prevent exiting.
    await submitIoc(hl.exchange!, ledger, NETWORK, user, { label: `${p.coin} reduce-only close`, asset: idx, isBuy: szi < 0, size: String(Math.abs(szi)), px, reduceOnly: true });
  });

  const reconcile = (o: OrderRecord) => act(() => reconcileOrder(hl.info, ledger, user, o.cloid));

  // ---- conversion ----
  const [unitMkt, setUnitMkt] = useState<SpotMarket | null>(null);
  const [convAmt, setConvAmt] = useState("0.1");
  const [convDir, setConvDir] = useState<ConversionPlan["direction"]>("to_usdc");
  const [plan, setPlan] = useState<ConversionPlan | null>(null);
  const [planMsg, setPlanMsg] = useState<string | null>(null);
  useEffect(() => { resolveSpot(hl, UNIT_ZEC_TOKEN_ID[NETWORK]).then(setUnitMkt).catch((e) => setPlanMsg(msg(e))); }, [hl]);
  const unitBal = unitMkt && snap ? availableSpot(snap.spot, unitMkt.base.index) : 0;
  const makePlan = async () => {
    setPlan(null); setPlanMsg(null);
    if (!unitMkt) return;
    if (convDir === "to_usdc" && Number(convAmt) > unitBal) { setPlanMsg(`Only ${unitBal} ${unitMkt.base.name} available`); return; }
    const r = await planConversion(hl, unitMkt, convDir, Number(convAmt), Number(slip));
    if (r.ok) setPlan(r.plan); else setPlanMsg(r.reason);
  };

  // ---- margin / builder ----
  const [moveAmt, setMoveAmt] = useState("");
  const spotUsdc = snap ? availableSpot(snap.spot, 0) : 0;

  return (
    <main>
      <div className="note warn">TESTNET PROTOTYPE: mock USDC only. The ZEC perp is delisted on testnet, so trading uses BTC/ETH.</div>
      <h1>Trade</h1>

      <AccountPanel acct={acct} />
      {err && <div className="note bad">{err}</div>}
      {blocking && (
        <div className="note bad">
          <b>Order outcome unknown:</b> {blocking.label} ({blocking.cloid}). New orders are paused until it is reconciled; closing stays available.
          {" "}{blocking.error && <i>{blocking.error}. </i>}
          Earliest &quot;not landed&quot; verdict: {new Date(notLandedAfter(blocking)).toLocaleTimeString()}.{" "}
          <button disabled={busy} onClick={() => reconcile(blocking)}>Reconcile now</button>
        </div>
      )}

      {snap && (<section className="panel">
        <h2>Balances</h2>
        <p>Perps account value {snap.perps.marginSummary.accountValue} USDC, withdrawable {snap.perps.withdrawable}</p>
        <p>Spot: {snap.spot.map((b) => `${b.coin} ${b.total}${Number(b.hold) ? ` (hold ${b.hold})` : ""}`).join(", ") || "none"}</p>
        {needsClassTransfer(snap.mode as any) ? (<p>
          Account mode &quot;{snap.mode}&quot;: spot USDC is not perps margin. Move{" "}
          <input size={8} value={moveAmt} onChange={(e) => setMoveAmt(e.target.value.trim())} placeholder={String(spotUsdc)} /> USDC spot → perps{" "}
          <button disabled={!canTrade || busy || !(Number(moveAmt) > 0 && Number(moveAmt) <= spotUsdc)}
            onClick={() => confirm(`Move ${moveAmt} USDC from spot to perps?`) && act(() => owner!.exchange!.usdClassTransfer({ amount: moveAmt, toPerp: true }))}>Move</button>
        </p>) : <p>Account mode &quot;{snap.mode}&quot;: spot USDC already counts as margin; no transfer needed.</p>}
      </section>)}

      <section className="panel">
        <h2>Convert Unit ZEC ⇄ USDC</h2>
        {unitMkt && <p className="mono">{unitMkt.base.name} token {unitMkt.base.tokenId} (resolved by ID), market {unitMkt.pair}, available {unitBal}</p>}
        <select value={convDir} onChange={(e) => { setConvDir(e.target.value as any); setPlan(null); }}>
          <option value="to_usdc">Sell {unitMkt?.base.name ?? "Unit ZEC"} for USDC</option>
          <option value="to_unit">Buy {unitMkt?.base.name ?? "Unit ZEC"} with USDC (for return)</option>
        </select>{" "}
        <input size={8} value={convAmt} onChange={(e) => { setConvAmt(e.target.value.trim()); setPlan(null); }} /> {unitMkt?.base.name}{" "}
        <button disabled={!unitMkt || busy} onClick={makePlan}>Quote</button>
        {planMsg && <div className="note warn">{planMsg}</div>}
        {plan && (<div>
          <p>Best {plan.quote.bestPx}, limit {plan.quote.boundPx} ({Number(slip) * 100}% bound). Visible book fills ~{plan.quote.estFillSz} of {plan.size} at avg ~{plan.quote.estAvgPx.toFixed(4)} (≈{plan.quote.estQuote.toFixed(2)} USDC).
            {plan.quote.partialExpected && <b> Expect a partial fill; the rest stays as {plan.market.base.name}.</b>}</p>
          <p style={{ fontSize: 13 }}>IOC: whatever does not fill inside the limit is cancelled, not retried at a worse price. Balances are re-read after the fill.</p>
          <button disabled={!canTrade || busy || !!blocking} onClick={() => act(async () => { await acct.ensureTrading(); await executeConversion(hl, ledger, NETWORK, user, plan); setPlan(null); })}>Confirm conversion</button>
        </div>)}
      </section>

      <section className="panel">
        <h2>Builder fee</h2>
        {!snap ? "…" : snap.builder.kind === "not_configured" ? <p>No builder configured (NEXT_PUBLIC_BUILDER_ADDRESS); orders carry no builder fee.</p>
          : snap.builder.kind === "approved" ? <p>Approved up to {snap.builder.maxF / 1000}% for {snap.builder.builder}. New orders add {BUILDER_FEE.rate}.</p>
          : (<p>
            {snap.builder.kind === "unreadable" ? `Could not read approval (${snap.builder.error}). ` : `Not approved (current max ${snap.builder.maxF / 1000}%). `}
            Orders work without it. Approving lets {snap.builder.builder} charge up to {BUILDER_FEE.rate} of notional on orders from this app. Signed by this account&apos;s own key; HL allows at most 10 active approvals.{" "}
            <button disabled={!canTrade || busy} onClick={() => confirm(`Approve builder fee up to ${BUILDER_FEE.rate}?`) && act(async () => {
              const r = await approveBuilder(owner!, BUILDER!); // this branch only renders when BUILDER is set
              if (!r.ok) throw new Error(r.limitReached ? `You already have the maximum of 10 builder approvals: ${r.error}. Trading and closing still work without it.` : `Approval failed: ${r.error}. Trading and closing still work.`);
            })}>Approve {BUILDER_FEE.rate}</button>
          </p>)}
      </section>

      <section className="panel">
        <h2>New position</h2>
        <select value={coin} onChange={(e) => { setCoin(e.target.value); setReview(false); }}>{PERPS.map((c) => <option key={c}>{c}</option>)}</select>{" "}
        <select value={side} onChange={(e) => { setSide(e.target.value as any); setReview(false); }}><option value="long">Long</option><option value="short">Short</option></select>{" "}
        <label>USDC notional <input size={6} value={usd} onChange={(e) => { setUsd(e.target.value.trim()); setReview(false); }} /></label>{" "}
        <label>Leverage <input size={3} value={lev} onChange={(e) => { setLev(e.target.value.trim()); setReview(false); }} />x (max {m?.maxLeverage ?? "?"})</label>{" "}
        <label>Slippage <input size={4} value={slip} onChange={(e) => setSlip(e.target.value.trim())} /></label>{" "}
        <button disabled={!!orderProblem || busy} onClick={() => setReview(true)}>Review</button>
        {orderProblem && <p style={{ fontSize: 13 }}>{orderProblem}</p>}
        {review && !orderProblem && (<div className="note info">
          <b>Review:</b> {side} {size} {coin} (≈{notional.toFixed(2)} USDC at mid {mid}), IOC limit {boundPx}.<br />
          Leverage {levN}x cross (sets {coin} leverage before the order) → margin ≈ {(notional / levN).toFixed(2)} USDC.<br />
          Est. fee ≈ {(notional * feeRate).toFixed(4)} USDC (taker {(snap!.takerRate * 100).toFixed(4)}%{builderAttach ? ` + builder ${BUILDER_FEE.rate}` : ""}). A partial or no fill is possible.<br />
          <button disabled={busy} onClick={placeOrder}>Confirm and sign</button> <button onClick={() => setReview(false)}>Cancel</button>
        </div>)}
      </section>

      {snap && (<section className="panel">
        <h2>Positions and orders</h2>
        {snap.perps.assetPositions.length === 0 && <p>No open positions.</p>}
        {snap.perps.assetPositions.map(({ position: p }: any) => (
          <p key={p.coin}>{p.coin} {p.szi} @ {p.entryPx}, {p.leverage.value}x {p.leverage.type}, uPnL {p.unrealizedPnl}, liq {p.liquidationPx ?? "n/a"}{" "}
            <button disabled={!canTrade || busy} onClick={() => confirm(`Reduce-only close ${p.szi} ${p.coin}?`) && closePos(p)}>Close (reduce-only)</button></p>
        ))}
        {snap.openOrders.map((o) => (
          <p key={o.oid}>Open {o.coin} {o.side === "B" ? "buy" : "sell"} {o.sz} @ {o.limitPx}{" "}
            <button disabled={!canTrade || busy} onClick={() => act(() => hl.exchange!.cancel({ cancels: [{ a: snap.meta.findIndex((u) => u.name === o.coin), o: o.oid }] }))}>Cancel</button></p>
        ))}
      </section>)}

      <section className="panel">
        <h2>Order journal (this browser) and fill evidence</h2>
        {orders.slice(0, 10).map((o) => (
          <details key={o.cloid} className="mono">
            <summary>{o.createdAt.slice(11, 19)} {o.label}: <b>{o.state}</b> {o.filledSz ? `filled ${o.filledSz}/${o.size} @ ${o.avgPx}` : `size ${o.size}`} [{o.evidence ?? "no exchange evidence"}]</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(o, null, 2)}</pre>
            {(o.state === "unknown" || o.state === "pending") && <button disabled={busy} onClick={() => reconcile(o)}>Reconcile</button>}
          </details>
        ))}
        <h3>Recent fills (Hyperliquid)</h3>
        {snap?.fills.map((f) => (
          <div key={f.tid} className="mono">{new Date(f.time).toLocaleTimeString()} {f.coin} {f.dir} {f.sz} @ {f.px} fee {f.fee}{f.builderFee ? ` builder ${f.builderFee}` : ""} {f.cloid ?? ""}</div>
        ))}
      </section>
    </main>
  );
}
