"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { privateKeyToAccount } from "viem/accounts";
import { Star } from "@/components/brand";
import type { Network } from "@/lib/bridge/guardians";
import { createHl, formatPerpPrice, formatSize, type Hl } from "@/lib/hl/client";
import { OrderBlockedError, OrderLedger, notLandedAfter, persistentNonceManager, reconcileOrder, submitIoc, type OrderRecord } from "@/lib/hl/orders";
import { executeConversion, planConversion, resolveSpot, availableSpot, type ConversionPlan, type SpotMarket } from "@/lib/hl/spot";
import { approveBuilder, BUILDER_FEE, builderForOrder, builderStatus, needsClassTransfer, readAccountMode, type BuilderStatus } from "@/lib/hl/account";
import { UNIT_ZEC_TOKEN_ID } from "@/lib/hl/xzec";

const NETWORK: Network = "testnet"; // ZEC perp is delisted on testnet; BTC/ETH only
const PERPS = ["BTC", "ETH"];
const BUILDER = process.env.NEXT_PUBLIC_BUILDER_ADDRESS as `0x${string}` | undefined;
const kv = () => { try { return window.localStorage; } catch { return undefined; } };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Snapshot = {
  perps: any; spot: any[]; mode: string; openOrders: any[]; fills: any[]; mids: Record<string, string>;
  meta: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[]; takerRate: number; builder: BuilderStatus;
};

export default function Trade() {
  const [key, setKey] = useState(""); // dedicated testnet key, memory only: never persisted or logged
  const [readAddr, setReadAddr] = useState("0x1f20B96A9fde5218ED05A212B2d23093100785c0");
  const signer = useMemo(() => { try { return /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as `0x${string}`) : undefined; } catch { return undefined; } }, [key]);
  const user = (signer?.address ?? readAddr) as `0x${string}`;
  const valid = /^0x[0-9a-fA-F]{40}$/.test(user);
  const hl: Hl = useMemo(() => createHl(NETWORK, signer, { nonceManager: persistentNonceManager(kv()) }), [signer]);
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
  const orderProblem = !signer ? "Unlock with the trading key to place orders" : !m || m.isDelisted ? `${coin} not tradable on ${NETWORK}`
    : Number(size) <= 0 ? "Size rounds to 0" : notional < 10 ? "Hyperliquid minimum order value is 10 USDC" : blocking ? "Reconcile the unknown order first" : null;

  const placeOrder = () => act(async () => {
    await hl.exchange!.updateLeverage({ asset: assetIndex, isCross: true, leverage: levN });
    await submitIoc(hl.exchange!, ledger, NETWORK, user, {
      label: `${coin} ${side} open`, asset: assetIndex, isBuy: side === "long", size, px: boundPx, builder: builderAttach,
    });
    setReview(false);
  });

  const closePos = (p: any) => act(async () => {
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

  const zecName = unitMkt?.base.name ?? "ZEC";
  const positions = snap?.perps.assetPositions ?? [];

  return (
    <main className="page">
      <header className="page-head">
        <span className="eyebrow"><Star /> Step 2 of 3 · Trade</span>
        <h1>Trade on <em>Hyperliquid</em></h1>
        <p className="lede">Swap your ZEC to USDC, then go long or short. You review every order before it&apos;s signed, and you can always close.</p>
        <span className="banner"><i />Testnet · mock USDC · BTC and ETH only (the ZEC market is delisted on testnet)</span>
      </header>

      <div className="stack">
        {blocking && (
          <div className="callout bad"><span className="callout-mark">!</span>
            <div>
              <b>We&apos;re not sure an order went through</b>
              <span>{blocking.label}. New orders are paused until we check with Hyperliquid; closing positions still works.{blocking.error && ` ${blocking.error}.`} We can call it &quot;not landed&quot; from {new Date(notLandedAfter(blocking)).toLocaleTimeString()}.</span>
              <div className="btn-row"><button className="btn-sm" disabled={busy} onClick={() => reconcile(blocking)}>Check now</button></div>
            </div>
          </div>
        )}
        {err && <div className="callout bad"><span className="callout-mark">!</span><div><b>Something went wrong</b><span>{err}</span></div></div>}

        <section className="card">
          <div className="card-head">
            <span className="card-n" data-done={signer ? "" : undefined}>{signer ? "✓" : "1"}</span>
            <div><h2>{signer ? "Account unlocked" : "Unlock your account"}</h2><p className="card-sub">Paste your trading account&apos;s key to place orders. It stays in this tab&apos;s memory and is never saved or sent anywhere.</p></div>
            <span className={`badge ${signer ? "good" : "ink"}`}><i />{signer ? "Can trade" : "View only"}</span>
          </div>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">Trading key</span>
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="0x…  (leave empty to just look)" />
            </label>
            {signer ? (
              <div className="field"><span className="field-label">Account</span><div className="addr"><code>{user}</code></div></div>
            ) : (
              <label className="field">
                <span className="field-label">Or view an address</span>
                <input value={readAddr} onChange={(e) => setReadAddr(e.target.value.trim())} spellCheck={false} />
              </label>
            )}
          </div>
          {snap && (
            <div className="stats">
              <div className="stat"><span>Account value</span><strong>{fmt(snap.perps.marginSummary.accountValue)}</strong><small>USDC</small></div>
              <div className="stat"><span>Withdrawable</span><strong>{fmt(snap.perps.withdrawable)}</strong><small>USDC</small></div>
              <div className="stat"><span>{zecName} ready to swap</span><strong>{unitBal}</strong><small>{zecName}</small></div>
            </div>
          )}
          {snap && needsClassTransfer(snap.mode as any) && (
            <div className="callout"><span className="callout-mark">i</span>
              <div>
                <b>Move USDC into your trading balance</b>
                <span>Your account keeps swap balance and trading margin separate. You have {spotUsdc} USDC available to move.</span>
                <div className="btn-row">
                  <input style={{ maxWidth: 180, height: 42 }} value={moveAmt} onChange={(e) => setMoveAmt(e.target.value.trim())} placeholder={String(spotUsdc)} aria-label="USDC to move" />
                  <button disabled={!signer || busy || !(Number(moveAmt) > 0 && Number(moveAmt) <= spotUsdc)}
                    onClick={() => confirm(`Move ${moveAmt} USDC from spot to perps?`) && act(() => hl.exchange!.usdClassTransfer({ amount: moveAmt, toPerp: true }))}>Move to trading</button>
                </div>
              </div>
            </div>
          )}
          <details className="more">
            <summary>Account details</summary>
            <ul>
              <li>Account mode: {snap?.mode ?? "…"}{snap && !needsClassTransfer(snap.mode as any) && " (spot USDC already counts as margin)"}</li>
              <li>Spot balances: {snap?.spot.map((b) => `${b.coin} ${b.total}${Number(b.hold) ? ` (hold ${b.hold})` : ""}`).join(", ") || "none"}</li>
              <li>If this site is unavailable, the recovery client can still read, cancel and reduce-only close: <code>recovery/recover.ts</code></li>
            </ul>
          </details>
        </section>

        <div className="split split-rev">
          <div className="stack">
            <section className="card">
              <div className="card-head"><span className="card-n">2</span><div><h2>Swap</h2><p className="card-sub">Turn {zecName} into USDC to trade, or buy {zecName} back before you return.</p></div></div>
              <div className="seg" role="group" aria-label="Swap direction">
                <button aria-pressed={convDir === "to_usdc"} onClick={() => { setConvDir("to_usdc"); setPlan(null); }}>{zecName} → USDC</button>
                <button aria-pressed={convDir === "to_unit"} onClick={() => { setConvDir("to_unit"); setPlan(null); }}>USDC → {zecName}</button>
              </div>
              <div className="amount">
                <input inputMode="decimal" value={convAmt} onChange={(e) => { setConvAmt(e.target.value.trim()); setPlan(null); }} aria-label={`Amount of ${zecName}`} />
                <span className="amount-unit">{zecName}</span>
              </div>
              {!plan && <button className="btn-block btn-ghost" disabled={!unitMkt || busy} onClick={makePlan}>Get a quote</button>}
              {planMsg && <div className="callout warn"><span className="callout-mark">!</span><div><span>{planMsg}</span></div></div>}
              {plan && (<>
                <div className="facts">
                  <div><span>You get about</span><b>{convDir === "to_usdc" ? `${plan.quote.estQuote.toFixed(2)} USDC` : `${plan.quote.estFillSz} ${zecName}`}</b></div>
                  <div><span>Avg price</span><b>{plan.quote.estAvgPx.toFixed(4)}</b></div>
                  <div><span>Worst price</span><b>{plan.quote.boundPx}</b></div>
                </div>
                {plan.quote.partialExpected && <div className="callout warn"><span className="callout-mark">!</span><div><span>Only part of this will fill right now; the rest stays as {plan.market.base.name}.</span></div></div>}
                <p className="small muted">Whatever can&apos;t fill within {Number(slip) * 100}% is cancelled, never retried at a worse price.</p>
                <div className="btn-row">
                  <button disabled={!signer || busy || !!blocking} onClick={() => act(async () => { await executeConversion(hl, ledger, NETWORK, user, plan); setPlan(null); })}>Confirm swap</button>
                  <button className="btn-ghost" onClick={() => setPlan(null)}>Cancel</button>
                </div>
              </>)}
              {unitMkt && <details className="more"><summary>Market details</summary><ul><li>{unitMkt.base.name} token {unitMkt.base.tokenId} (resolved by ID), market {unitMkt.pair}. Best price {plan?.quote.bestPx ?? "—"}.</li></ul></details>}
            </section>

            <section className="card">
              <div className="card-head"><div><h2 style={{ fontSize: 24 }}>finity fee</h2>
                <p className="card-sub">{!snap ? "Checking…"
                  : snap.builder.kind === "not_configured" ? "No finity fee is set up; orders carry no extra fee."
                  : snap.builder.kind === "approved" ? `Approved up to ${snap.builder.maxF / 1000}%. New orders add ${BUILDER_FEE.rate}.`
                  : `Optional. Trading works without it. Approving lets finity charge up to ${BUILDER_FEE.rate} on orders placed here.`}</p></div>
                {snap?.builder.kind === "approved" && <span className="badge good"><i />On</span>}
              </div>
              {snap && (snap.builder.kind === "not_approved" || snap.builder.kind === "unreadable") && (<>
                {snap.builder.kind === "unreadable" && <p className="small muted">Couldn&apos;t read your approval ({snap.builder.error}).</p>}
                <button className="btn-ghost btn-block" disabled={!signer || busy} onClick={() => confirm(`Approve builder fee up to ${BUILDER_FEE.rate}?`) && act(async () => {
                  const r = await approveBuilder(hl, BUILDER!); // this branch only renders when BUILDER is set
                  if (!r.ok) throw new Error(r.limitReached ? `You already have the maximum of 10 builder approvals: ${r.error}. Trading and closing still work without it.` : `Approval failed: ${r.error}. Trading and closing still work.`);
                })}>Approve {BUILDER_FEE.rate}</button>
                <p className="small muted">Builder {snap.builder.builder}; signed by your own key. Hyperliquid allows 10 active approvals.</p>
              </>)}
            </section>
          </div>

          <section className="card">
            <div className="card-head"><span className="card-n">3</span><div><h2>Open a position</h2><p className="card-sub">Pick a market and direction. Nothing is sent until you confirm.</p></div></div>
            <div className="grid-2">
              <div className="seg" role="group" aria-label="Market">
                {PERPS.map((c) => <button key={c} aria-pressed={coin === c} onClick={() => { setCoin(c); setReview(false); }}>{c}</button>)}
              </div>
              <div className="seg" role="group" aria-label="Direction">
                <button data-tone="long" aria-pressed={side === "long"} onClick={() => { setSide("long"); setReview(false); }}>Long ↑</button>
                <button data-tone="short" aria-pressed={side === "short"} onClick={() => { setSide("short"); setReview(false); }}>Short ↓</button>
              </div>
            </div>
            <label className="field">
              <span className="field-label">Position size</span>
              <div className="amount">
                <input inputMode="decimal" value={usd} onChange={(e) => { setUsd(e.target.value.trim()); setReview(false); }} aria-label="Position size in USDC" />
                <span className="amount-unit">USDC</span>
              </div>
              <span className="amount-foot"><span>{coin} price {mid ? fmt(mid) : "…"}</span><b>≈ {size} {coin}</b></span>
            </label>
            <div className="grid-2">
              <label className="field">
                <span className="field-label">Leverage (max {m?.maxLeverage ?? "?"}x)</span>
                <input inputMode="decimal" value={lev} onChange={(e) => { setLev(e.target.value.trim()); setReview(false); }} />
              </label>
              <label className="field">
                <span className="field-label">Max price move</span>
                <input inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value.trim())} />
              </label>
            </div>
            {!review || orderProblem ? (<>
              <button className="btn-lg btn-block" disabled={!!orderProblem || busy} onClick={() => setReview(true)}>Review {side} {coin}</button>
              {orderProblem && <p className="small muted" style={{ textAlign: "center" }}>{orderProblem}</p>}
            </>) : (
              <div className="callout"><span className="callout-mark">✓</span>
                <div>
                  <b>{side === "long" ? "Long" : "Short"} {size} {coin}</b>
                  <div className="facts">
                    <div><span>Size</span><b>≈ {notional.toFixed(2)} USDC</b></div>
                    <div><span>Margin used</span><b>≈ {(notional / levN).toFixed(2)} USDC</b></div>
                    <div><span>Leverage</span><b>{levN}x cross</b></div>
                    <div><span>Est. fee</span><b>≈ {(notional * feeRate).toFixed(4)} USDC</b></div>
                  </div>
                  <span className="small muted">Fills right away up to {boundPx} or not at all. Taker {(snap!.takerRate * 100).toFixed(4)}%{builderAttach ? ` + finity ${BUILDER_FEE.rate}` : ""}. A partial or no fill is possible.</span>
                  <div className="btn-row"><button disabled={busy} onClick={placeOrder}>Confirm and sign</button><button className="btn-ghost" onClick={() => setReview(false)}>Back</button></div>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="card">
          <div className="card-head"><div><h2>Your positions</h2><p className="card-sub">Closing only ever reduces a position, and is never blocked.</p></div></div>
          {!snap ? <div className="empty">Loading…</div> : positions.length === 0 && snap.openOrders.length === 0 ? <div className="empty">No open positions or orders.</div> : (
            <div className="rows">
              {positions.map(({ position: p }: any) => (
                <div className="row" key={p.coin}>
                  <div className="row-main">
                    <b>{p.coin} <span className={`badge ${Number(p.szi) < 0 ? "bad" : "good"}`}>{Number(p.szi) < 0 ? "Short" : "Long"} {p.leverage.value}x</span></b>
                    <small>{Math.abs(Number(p.szi))} @ {p.entryPx} · liq {p.liquidationPx ?? "n/a"}</small>
                  </div>
                  <div className="btn-row">
                    <span style={{ color: Number(p.unrealizedPnl) < 0 ? "var(--bad)" : "var(--good)", fontWeight: 500 }}>{Number(p.unrealizedPnl) >= 0 ? "+" : ""}{p.unrealizedPnl} USDC</span>
                    <button className="btn-sm btn-danger" disabled={!signer || busy} onClick={() => confirm(`Reduce-only close ${p.szi} ${p.coin}?`) && closePos(p)}>Close</button>
                  </div>
                </div>
              ))}
              {snap.openOrders.map((o) => (
                <div className="row" key={o.oid}>
                  <div className="row-main"><b>{o.coin} {o.side === "B" ? "buy" : "sell"} order</b><small>{o.sz} @ {o.limitPx}</small></div>
                  <button className="btn-sm btn-ghost" disabled={!signer || busy} onClick={() => act(() => hl.exchange!.cancel({ cancels: [{ a: snap.meta.findIndex((u) => u.name === o.coin), o: o.oid }] }))}>Cancel</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Activity</h2><p className="card-sub">Orders placed from this browser, and fills reported by Hyperliquid.</p></div></div>
          {orders.length === 0 && !snap?.fills.length ? <div className="empty">No activity yet.</div> : (
            <div className="rows">
              {orders.slice(0, 10).map((o) => (
                <div className="row" key={o.cloid}>
                  <div className="row-main">
                    <b>{o.label}</b>
                    <small>{o.createdAt.slice(11, 19)} · {o.filledSz ? `filled ${o.filledSz}/${o.size} @ ${o.avgPx}` : `size ${o.size}`}</small>
                  </div>
                  <div className="btn-row">
                    <span className={`badge ${ORDER_TONE[o.state] ?? ""}`}><i />{o.state}</span>
                    {(o.state === "unknown" || o.state === "pending") && <button className="btn-sm btn-ghost" disabled={busy} onClick={() => reconcile(o)}>Check</button>}
                  </div>
                </div>
              ))}
              {snap?.fills.map((f) => (
                <div className="row" key={f.tid}>
                  <div className="row-main"><b>{f.coin} · {f.dir}</b><small>{new Date(f.time).toLocaleTimeString()} · {f.sz} @ {f.px}</small></div>
                  <small className="muted">fee {f.fee}{f.builderFee ? ` + ${f.builderFee}` : ""}</small>
                </div>
              ))}
            </div>
          )}
          {orders.length > 0 && (
            <details className="more">
              <summary>Order records</summary>
              {orders.slice(0, 10).map((o) => <pre key={o.cloid}>{JSON.stringify(o, null, 2)}</pre>)}
            </details>
          )}
        </section>

        <Link className="btn btn-lg btn-ghost" href="/return" style={{ justifySelf: "center" }}>Done trading? Bring your ZEC home →</Link>
      </div>
    </main>
  );
}

const fmt = (v: string | number) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v); };
const ORDER_TONE: Record<string, string> = { filled: "good", partial: "warn", pending: "warn", unknown: "bad", rejected: "bad", not_landed: "bad" };
