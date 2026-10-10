"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { Network } from "@/lib/bridge/guardians";
import { createHl, formatPerpPrice, formatSize } from "@/lib/hl/client";
import { OrderBlockedError, OrderLedger, notLandedAfter, reconcileOrder, submitIoc, type OrderRecord } from "@/lib/hl/orders";
import { executeConversion, planConversion, resolveSpot, availableSpot, type ConversionPlan, type SpotMarket } from "@/lib/hl/spot";
import { approveBuilder, BUILDER_FEE, builderForOrder, builderStatus, needsClassTransfer, readAccountMode, type BuilderStatus } from "@/lib/hl/account";
import { UNIT_ZEC_TOKEN_ID } from "@/lib/hl/xzec";
import { useAccount } from "@/components/wallet/account";
import { Callout, EASE, Empty, Icon, Ticker, TokenIcon, TokenRow } from "@/components/wallet/ui";

const NETWORK: Network = "testnet"; // ZEC perp is delisted on testnet; BTC/ETH only
const PERPS = ["BTC", "ETH"];
const BUILDER = process.env.NEXT_PUBLIC_BUILDER_ADDRESS as `0x${string}` | undefined;
const kv = () => { try { return window.localStorage; } catch { return undefined; } };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Snapshot = {
  perps: any; spot: any[]; mode: string; openOrders: any[]; fills: any[]; mids: Record<string, string>;
  meta: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[]; takerRate: number; builder: BuilderStatus;
};
type Tab = "swap" | "trade" | "activity";
const TABS: { id: Tab; label: string }[] = [{ id: "swap", label: "Swap" }, { id: "trade", label: "Trade" }, { id: "activity", label: "Activity" }];

export default function Trade() {
  const { acct, user, valid, setSheet } = useAccount();
  const c = acct.clients;
  const canTrade = !!c;
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

  // ---- view ----
  const [tab, setTab] = useState<Tab>("trade");
  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab"); if (t === "swap" || t === "activity" || t === "trade") setTab(t); }, []);
  const [flips, setFlips] = useState(0);
  const zecName = unitMkt?.base.name ?? "ZEC";
  const positions = snap?.perps.assetPositions ?? [];
  const zecPanel = (
    <div className="swap-panel">
      <div className="swap-top"><span>{convDir === "to_usdc" ? "You pay" : "You receive"}</span>
        {convDir === "to_usdc" && <button type="button" className="link-sm" onClick={() => { setConvAmt(String(unitBal)); setPlan(null); }}>Max {unitBal}</button>}</div>
      <div className="swap-row">
        <input inputMode="decimal" value={convAmt} onChange={(e) => { setConvAmt(e.target.value.trim()); setPlan(null); }} aria-label={`Amount of ${zecName}`} />
        <span className="token-pill"><TokenIcon kind="zec" />{zecName}</span>
      </div>
    </div>
  );
  const usdcPanel = (
    <div className="swap-panel">
      <div className="swap-top"><span>{convDir === "to_usdc" ? "You receive" : "You pay"}</span><span className="muted">Balance {spotUsdc.toFixed(2)}</span></div>
      <div className="swap-row">
        <span className="swap-est">{plan ? (convDir === "to_usdc" ? plan.quote.estQuote.toFixed(2) : `≈ ${plan.quote.estQuote.toFixed(2)}`) : "—"}</span>
        <span className="token-pill"><TokenIcon kind="usdc" />USDC</span>
      </div>
    </div>
  );

  return (
    <div className="trade">
      <div className="seg-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {tab === t.id && <motion.span layoutId="trade-tab" className="seg-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {blocking && (
        <Callout tone="bad" title="We're not sure an order went through">
          <span>{blocking.label}. New orders are paused until we check with Hyperliquid; closing positions still works.{blocking.error && ` ${blocking.error}.`} We can call it &quot;not landed&quot; from {new Date(notLandedAfter(blocking)).toLocaleTimeString()}.</span>
          <div className="btn-row"><button type="button" className="btn btn-sm" disabled={busy} onClick={() => reconcile(blocking)}>Check now</button></div>
        </Callout>
      )}
      {err && <Callout tone="bad" title="Something went wrong">{err}</Callout>}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} className="stack" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25, ease: EASE }}>

          {tab === "swap" && (<>
            <div className="swap">
              {convDir === "to_usdc" ? <>{zecPanel}{usdcPanel}</> : <>{usdcPanel}{zecPanel}</>}
              <motion.button type="button" className="swap-flip" aria-label="Flip direction" animate={{ rotate: flips * 180 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}
                onClick={() => { setFlips((f) => f + 1); setConvDir((d) => (d === "to_usdc" ? "to_unit" : "to_usdc")); setPlan(null); }}>
                <Icon name="swap" />
              </motion.button>
            </div>
            {planMsg && <Callout tone="warn">{planMsg}</Callout>}
            <AnimatePresence>
              {plan && (
                <motion.div className="stack-sm" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <div className="facts">
                    <div><span>Avg price</span><b>{plan.quote.estAvgPx.toFixed(4)}</b></div>
                    <div><span>Worst price</span><b>{plan.quote.boundPx}</b></div>
                    <div><span>Fills</span><b>{plan.quote.estFillSz} / {plan.size}</b></div>
                  </div>
                  {plan.quote.partialExpected && <Callout tone="warn">Only part of this will fill right now; the rest stays as {plan.market.base.name}.</Callout>}
                  <p className="small muted center">Anything that can&apos;t fill within {Number(slip) * 100}% is cancelled, never retried at a worse price.</p>
                </motion.div>
              )}
            </AnimatePresence>
            {!plan ? (
              <button type="button" className="btn btn-lg btn-block" disabled={!unitMkt || busy} onClick={makePlan}>Get a quote</button>
            ) : !canTrade ? (
              <button type="button" className="btn btn-lg btn-block" onClick={() => setSheet(true)}><Icon name="lock" />Create account to swap</button>
            ) : (
              <div className="btn-row">
                <button type="button" className="btn btn-ghost" onClick={() => setPlan(null)}>Cancel</button>
                <button type="button" className="btn btn-lg grow" disabled={busy || !!blocking} onClick={() => act(async () => { await acct.ensureTrading(); await executeConversion(hl, ledger, NETWORK, user, plan); setPlan(null); })}>
                  {busy && <span className="spinner" />}Confirm swap
                </button>
              </div>
            )}
            {unitMkt && <details className="more"><summary>Market details</summary><ul><li>{unitMkt.base.name} token {unitMkt.base.tokenId} (resolved by ID), market {unitMkt.pair}. Best price {plan?.quote.bestPx ?? "—"}.</li></ul></details>}
          </>)}

          {tab === "trade" && (<>
            <div className="market">
              <div className="seg small-seg" role="group" aria-label="Market">
                {PERPS.map((c) => <button key={c} type="button" aria-pressed={coin === c} onClick={() => { setCoin(c); setReview(false); }}>{c}</button>)}
              </div>
              <div className="market-px"><span className="eyebrow">{coin}-PERP</span><b>$<Ticker value={mid} decimals={mid > 1000 ? 0 : 2} /></b></div>
            </div>

            <div className="seg side-seg" role="group" aria-label="Direction">
              <button type="button" data-tone="long" aria-pressed={side === "long"} onClick={() => { setSide("long"); setReview(false); }}>Long ↑</button>
              <button type="button" data-tone="short" aria-pressed={side === "short"} onClick={() => { setSide("short"); setReview(false); }}>Short ↓</button>
            </div>

            <div className="swap-panel">
              <div className="swap-top"><span>Size</span><span className="muted">≈ {size} {coin}</span></div>
              <div className="swap-row">
                <input inputMode="decimal" value={usd} onChange={(e) => { setUsd(e.target.value.trim()); setReview(false); }} aria-label="Position size in USDC" />
                <span className="token-pill"><TokenIcon kind="usdc" />USDC</span>
              </div>
            </div>

            <div className="lev">
              <div className="swap-top"><span>Leverage</span><b>{levN}x</b></div>
              <input type="range" min={1} max={m?.maxLeverage ?? 20} value={levN} onChange={(e) => { setLev(e.target.value); setReview(false); }} aria-label="Leverage"
                style={{ "--fill": `${((levN - 1) / Math.max(1, (m?.maxLeverage ?? 20) - 1)) * 100}%` } as React.CSSProperties} />
              <div className="lev-scale"><span>1x</span><span>max {m?.maxLeverage ?? "?"}x</span></div>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {!review || orderProblem ? (
                <motion.div key="cta" className="stack-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {!canTrade ? <button type="button" className="btn btn-lg btn-block" onClick={() => setSheet(true)}><Icon name="lock" />Create account to trade</button>
                    : <button type="button" className={`btn btn-lg btn-block ${side === "long" ? "btn-long" : "btn-short"}`} disabled={!!orderProblem || busy} onClick={() => setReview(true)}>Review {side} {coin}</button>}
                  {orderProblem && canTrade && <p className="small muted center">{orderProblem}</p>}
                </motion.div>
              ) : (
                <motion.div key="review" className="review" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.3, ease: EASE }}>
                  <div className="review-head"><span className={`badge ${side === "long" ? "good" : "bad"}`}>{side}</span><b>{size} {coin}</b></div>
                  <div className="facts">
                    <div><span>Size</span><b>≈ {notional.toFixed(2)} USDC</b></div>
                    <div><span>Margin used</span><b>≈ {(notional / levN).toFixed(2)} USDC</b></div>
                    <div><span>Leverage</span><b>{levN}x cross</b></div>
                    <div><span>Est. fee</span><b>≈ {(notional * feeRate).toFixed(4)}</b></div>
                  </div>
                  <p className="small muted">Fills right away up to {boundPx} or not at all. Taker {(snap!.takerRate * 100).toFixed(4)}%{builderAttach ? ` + finity ${BUILDER_FEE.rate}` : ""}. A partial or no fill is possible.</p>
                  <div className="btn-row">
                    <button type="button" className="btn btn-ghost" onClick={() => setReview(false)}>Back</button>
                    <button type="button" className="btn grow" disabled={busy} onClick={placeOrder}>{busy && <span className="spinner" />}Confirm and sign</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {snap && (
              <div className="facts">
                <div><span>Account value</span><b>{fmt(snap.perps.marginSummary.accountValue)}</b></div>
                <div><span>Withdrawable</span><b>{fmt(snap.perps.withdrawable)}</b></div>
              </div>
            )}

            {snap && needsClassTransfer(snap.mode as any) && spotUsdc > 0 && (
              <Callout title="Move USDC into trading">
                <span>Your swap balance and trading margin are separate. {spotUsdc} USDC can move over.</span>
                <div className="btn-row">
                  <input className="input-sm" value={moveAmt} onChange={(e) => setMoveAmt(e.target.value.trim())} placeholder={String(spotUsdc)} aria-label="USDC to move" />
                  <button type="button" className="btn btn-sm" disabled={!canTrade || busy || !(Number(moveAmt) > 0 && Number(moveAmt) <= spotUsdc)}
                    onClick={() => confirm(`Move ${moveAmt} USDC from spot to perps?`) && act(() => owner!.exchange!.usdClassTransfer({ amount: moveAmt, toPerp: true }))}>Move</button>
                </div>
              </Callout>
            )}

            <div className="section">
              <div className="section-head"><h3>Positions</h3><small className="muted">Closing is never blocked</small></div>
              {!snap ? <div className="list"><div className="token-row"><span className="skeleton" style={{ width: "60%" }} /></div></div>
                : positions.length === 0 && snap.openOrders.length === 0 ? <Empty>No open positions.</Empty> : (
                <div className="list">
                  {positions.map(({ position: p }: any) => (
                    <div className="token-row" key={p.coin}>
                      <TokenIcon kind={p.coin === "ETH" ? "eth" : "btc"} />
                      <div className="token-main"><b>{p.coin} {Number(p.szi) < 0 ? "Short" : "Long"} {p.leverage.value}x</b><small>{Math.abs(Number(p.szi))} @ {p.entryPx} · liq {p.liquidationPx ?? "n/a"}</small></div>
                      <div className="token-amt">
                        <b className={Number(p.unrealizedPnl) < 0 ? "down" : "up"}>{Number(p.unrealizedPnl) >= 0 ? "+" : ""}{p.unrealizedPnl}</b>
                        <button type="button" className="btn btn-sm btn-danger" disabled={!canTrade || busy} onClick={() => confirm(`Reduce-only close ${p.szi} ${p.coin}?`) && closePos(p)}>Close</button>
                      </div>
                    </div>
                  ))}
                  {snap.openOrders.map((o) => (
                    <div className="token-row" key={o.oid}>
                      <TokenIcon kind={o.coin === "ETH" ? "eth" : "btc"} />
                      <div className="token-main"><b>{o.coin} {o.side === "B" ? "buy" : "sell"} order</b><small>{o.sz} @ {o.limitPx}</small></div>
                      <button type="button" className="btn btn-sm btn-ghost" disabled={!canTrade || busy} onClick={() => act(() => hl.exchange!.cancel({ cancels: [{ a: snap.meta.findIndex((u) => u.name === o.coin), o: o.oid }] }))}>Cancel</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="fee-row">
              <span><b>finity fee</b><small>{!snap ? "Checking…"
                : snap.builder.kind === "not_configured" ? "Not set up; orders carry no extra fee."
                : snap.builder.kind === "approved" ? `Approved up to ${snap.builder.maxF / 1000}%. Orders add ${BUILDER_FEE.rate}.`
                : snap.builder.kind === "unreadable" ? `Couldn't read approval (${snap.builder.error}). Trading works without it.`
                : `Optional, up to ${BUILDER_FEE.rate}. Trading works without it.`}</small></span>
              {snap && (snap.builder.kind === "not_approved" || snap.builder.kind === "unreadable") && (
                <button type="button" className="btn btn-sm btn-ghost" disabled={!canTrade || busy} onClick={() => confirm(`Approve builder fee up to ${BUILDER_FEE.rate}?`) && act(async () => {
                  const r = await approveBuilder(owner!, BUILDER!); // this branch only renders when BUILDER is set
                  if (!r.ok) throw new Error(r.limitReached ? `You already have the maximum of 10 builder approvals: ${r.error}. Trading and closing still work without it.` : `Approval failed: ${r.error}. Trading and closing still work.`);
                })}>Approve</button>
              )}
            </div>

            <details className="more">
              <summary>Advanced</summary>
              <label className="field">
                <span className="field-label">Max price move (slippage bound)</span>
                <input inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value.trim())} />
              </label>
              <ul>
                <li>Account mode: {snap?.mode ?? "…"}{snap && !needsClassTransfer(snap.mode as any) && " (spot USDC already counts as margin)"}</li>
                <li>Spot balances: {snap?.spot.map((b) => `${b.coin} ${b.total}${Number(b.hold) ? ` (hold ${b.hold})` : ""}`).join(", ") || "none"}</li>
                {snap && snap.builder.kind !== "not_configured" && <li>Builder {snap.builder.builder}; approvals are signed by your own key, max 10 active.</li>}
                <li>If this site is unavailable, the recovery client can still read, cancel and reduce-only close: <code>recovery/recover.ts</code></li>
              </ul>
            </details>
          </>)}

          {tab === "activity" && (<>
            {orders.length === 0 && !snap?.fills.length ? <Empty>No activity yet.</Empty> : (
              <div className="list">
                {orders.slice(0, 10).map((o) => (
                  <div className="token-row" key={o.cloid}>
                    <span className="token-ic token-perp"><Icon name="trade" /></span>
                    <div className="token-main"><b>{o.label}</b><small>{o.createdAt.slice(11, 19)} · {o.filledSz ? `filled ${o.filledSz}/${o.size} @ ${o.avgPx}` : `size ${o.size}`}</small></div>
                    <div className="token-amt">
                      <span className={`badge ${ORDER_TONE[o.state] ?? ""}`}><i />{o.state}</span>
                      {(o.state === "unknown" || o.state === "pending") && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => reconcile(o)}>Check</button>}
                    </div>
                  </div>
                ))}
                {snap?.fills.map((f) => (
                  <TokenRow key={f.tid} icon={<TokenIcon kind={f.coin.includes("/") ? "usdc" : f.coin === "ETH" ? "eth" : "btc"} />} name={`${f.coin} · ${f.dir}`}
                    sub={`${new Date(f.time).toLocaleTimeString()} · ${f.sz} @ ${f.px}`} amount={`fee ${f.fee}`} value={f.builderFee ? `+ ${f.builderFee}` : undefined} />
                ))}
              </div>
            )}
            {orders.length > 0 && (
              <details className="more">
                <summary>Order records</summary>
                {orders.slice(0, 10).map((o) => <pre key={o.cloid}>{JSON.stringify(o, null, 2)}</pre>)}
              </details>
            )}
          </>)}
        </motion.div>
      </AnimatePresence>

      <Link href="/return" className="next-step">Done trading? <b>Send your ZEC home</b><span className="chev">›</span></Link>
    </div>
  );
}

const fmt = (v: string | number) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v); };
const ORDER_TONE: Record<string, string> = { filled: "good", partial: "warn", pending: "warn", unknown: "bad", rejected: "bad", not_landed: "bad" };
