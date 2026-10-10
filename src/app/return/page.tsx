"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import type { Network } from "@/lib/bridge/guardians";
import { createHl, type Hl } from "@/lib/hl/client";
import { persistentNonceManager } from "@/lib/hl/orders";
import { availableSpot, resolveSpot, type SpotMarket } from "@/lib/hl/spot";
import { UNIT_ZEC_TOKEN_ID } from "@/lib/hl/xzec";
import { UnitBridgeAdapter, type ZcashFees } from "@/lib/bridge/unit";
import {
  checkReturnDestination, deriveReturn, generateReturnRoute, markShielding, mergeReturnOperations, planReturn,
  reconcileReturnSend, residualOptions, submitReturnSend, type ReturnRecord,
} from "@/lib/bridge/returns";
import { deriveFunding } from "@/lib/bridge/funding";
import { accountBalances, fullyAccounted } from "@/lib/accounting";
import { loadFunding, loadReturn, saveReturn } from "@/lib/store/funding-store";
import { formatZecAmount } from "@/lib/zcash/address";

const NETWORK: Network = "testnet"; // mainnet return is disabled in this prototype
const kv = () => { try { return window.localStorage; } catch { return undefined; } };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const zec = (z: bigint) => formatZecAmount(z) + " ZEC";
const mono: React.CSSProperties = { fontFamily: "var(--font-mono), monospace", fontSize: 13 };

type Snap = { perps: any; spot: any[]; openOrders: any[]; weiDecimals: number; mid: number | null };

export default function Return() {
  const [key, setKey] = useState(""); // memory only
  const [readAddr, setReadAddr] = useState("0x1f20B96A9fde5218ED05A212B2d23093100785c0");
  const signer = useMemo(() => { try { return /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as `0x${string}`) : undefined; } catch { return undefined; } }, [key]);
  const user = (signer?.address ?? readAddr) as `0x${string}`;
  const valid = /^0x[0-9a-fA-F]{40}$/.test(user);
  const hl: Hl = useMemo(() => createHl(NETWORK, signer, { nonceManager: persistentNonceManager(kv()) }), [signer]);

  const [mkt, setMkt] = useState<SpotMarket | null>(null);
  const [fees, setFees] = useState<ZcashFees | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [rec, setRec] = useState<ReturnRecord | null>(null);
  const [dest, setDest] = useState("");
  const [freshAck, setFreshAck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const id = { network: NETWORK, hlAddress: user, source: "unit-live" as const };
  const persist = useCallback((r: ReturnRecord) => { setRec(r); saveReturn(kv(), r); }, []);
  useEffect(() => { setRec(valid ? loadReturn(kv(), id) : null); }, [user, valid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    resolveSpot(hl, UNIT_ZEC_TOKEN_ID[NETWORK]).then(setMkt).catch((e) => setErr(msg(e)));
    new UnitBridgeAdapter(NETWORK).fees().then(setFees).catch((e) => setErr(`Unit fees unavailable: ${msg(e)}`));
  }, [hl]);

  const refresh = useCallback(async () => {
    if (!valid || !mkt) return;
    try {
      const [perps, spot, openOrders, meta, mids] = await Promise.all([
        hl.info.clearinghouseState({ user }), hl.info.spotClearinghouseState({ user }), hl.info.openOrders({ user }), hl.info.spotMeta(), hl.info.allMids(),
      ]);
      const t = meta.tokens.find((x) => x.tokenId === mkt.base.tokenId)!;
      setSnap({ perps, spot: spot.balances, openOrders, weiDecimals: t.weiDecimals, mid: Number(mids[mkt.pair]) || null });
    } catch (e) { setErr(`Read failed (showing last known state): ${msg(e)}`); }
    // Unit operations for this return; errors are recorded, never read as "nothing happened".
    const cur = loadReturn(kv(), id);
    if (cur?.send && cur.send.state !== "rejected") {
      try {
        const a = new UnitBridgeAdapter(NETWORK);
        const [x, y] = await Promise.all([a.operations(user), a.operations(cur.route.destination as any).catch(() => ({ operations: [] }))]);
        persist(mergeReturnOperations(cur, [...x.operations, ...y.operations]));
      } catch (e) { persist({ ...cur, lastPollError: { at: new Date().toISOString(), message: msg(e) } }); }
    }
  }, [hl, user, valid, mkt, persist]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); const t = setInterval(refresh, 15_000); return () => clearInterval(t); }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => { setErr(null); setBusy(true); try { await fn(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); refresh(); } };

  const view = rec ? deriveReturn(rec) : null;
  const avail = mkt && snap ? availableSpot(snap.spot, mkt.base.index) : 0;
  const availStr = mkt && snap ? (snap.spot.find((b) => b.token === mkt.base.index)?.total ?? "0") : "0";
  const hold = mkt && snap ? Number(snap.spot.find((b) => b.token === mkt.base.index)?.hold ?? 0) : 0;
  const plan = fees && snap && mkt ? planReturn(hold ? String(avail) : availStr, snap.weiDecimals, fees) : null;
  const exposure = snap ? snap.perps.assetPositions.filter((p: any) => Number(p.position.szi) !== 0) : [];
  const destCheck = dest ? checkReturnDestination(dest, NETWORK) : null;
  const usdcSpot = snap ? availableSpot(snap.spot, 0) : 0;

  const funding = useMemo(() => { const f = valid ? loadFunding(kv(), id) : null; return f ? deriveFunding(f, null) : null; }, [user, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = snap ? accountBalances({ perpsAccountValue: snap.perps.marginSummary.accountValue, spot: snap.spot, unitTokenIndex: mkt?.base.index ?? null, funding, ret: rec && view ? { rec, view } : null }) : [];

  return (
    <main>
      <div className="note warn">TESTNET PROTOTYPE: mainnet return is disabled.</div>
      <div className="note bad">
        <b>Testnet return lane, honest status (8 Oct):</b> Unit testnet generates and signs return addresses for fresh <code>tm…</code> destinations (verified 3/3 against pinned keys).
        No XZEC has reached this account (no testnet ZEC deposit yet), so <b>no real return has been sent or delivered</b>. The send step below is live code, never exercised with funds.
      </div>
      <h1>Return to Zcash</h1>

      <section className="panel">
        <p><label>Trading key (memory only)<br /><input type="password" autoComplete="off" style={{ width: "100%", ...mono }} value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="0x… (empty = read-only)" /></label></p>
        {!signer && <p><label>Read-only address<br /><input style={{ width: "100%", ...mono }} value={readAddr} onChange={(e) => setReadAddr(e.target.value.trim())} /></label></p>}
        <p className="mono">Account {user} {signer ? "(can sign)" : "(read-only)"}</p>
      </section>
      {err && <div className="note bad">{err}</div>}

      <section className="panel">
        <h2>1. Close exposure</h2>
        {!snap ? "…" : exposure.length === 0 && snap.openOrders.length === 0 ? <p>No open positions or orders.</p> : (<>
          <p><b>Remaining exposure:</b> {exposure.map((p: any) => `${p.position.coin} ${p.position.szi}`).join(", ") || "none"}; open orders {snap.openOrders.length}.</p>
          <p>Close or cancel on <a href="/trade">Trade</a> (reduce-only closes are never blocked). You can return without closing; only free Unit ZEC is sent.</p>
        </>)}
        <p>Then buy Unit ZEC with USDC on <a href="/trade">Trade</a> (“Buy … for return”): a price-bounded IOC with HL&apos;s 10 USDC order minimum. Only the filled amount below counts.</p>
      </section>

      <section className="panel">
        <h2>2. What can return</h2>
        {mkt && <p className="mono">{mkt.base.name} {mkt.base.tokenId} (by ID) → spotSend selector {mkt.tokenSelector}</p>}
        <p>Free {mkt?.base.name ?? "Unit ZEC"}: {avail}{hold ? ` (${hold} on hold)` : ""}</p>
        {fees && <p>Unit outbound fee now {zec(fees.withdrawalFeeZat)}, Unit ETA {fees.withdrawalEta} (fetched {fees.fetchedAt}). HL may also charge a 1 USDC activation fee if the Unit address is new.</p>}
        {plan && (plan.ok
          ? <p>Sendable: <b>{plan.sendAmount}</b>; estimated net in your wallet ≈ {zec(plan.estNetZat)} (before Zcash network fees).</p>
          : (<div className="note warn"><b>{plan.reason}</b>
            {plan.kind !== "fee_exceeds" && <ul>{residualOptions({ residualZat: plan.residualZat, usdcAvailable: usdcSpot, zecPx: snap?.mid ?? null }).map((o) => <li key={o}>{o}</li>)}</ul>}</div>))}
      </section>

      <section className="panel">
        <h2>3. Destination</h2>
        {rec ? <p className="mono">Route: {rec.route.destination} via Unit {rec.route.unitHlAddress}, guardians {rec.route.verification.verifiedCount}/3 (pinned {rec.network} keys)</p> : (<>
          <label>Fresh transparent receive address from your Zcash wallet ({NETWORK === "testnet" ? "tm…" : "t1…"})<br />
            <input style={{ width: "100%", ...mono }} value={dest} onChange={(e) => setDest(e.target.value)} /></label>
          {destCheck && !destCheck.ok && <div className="note bad">{destCheck.reason}</div>}
          <p><label><input type="checkbox" checked={freshAck} onChange={(e) => setFreshAck(e.target.checked)} /> I generated this address just now in my own wallet and have not used it before. The payout to it is public on Zcash.</label></p>
          <button disabled={busy || !destCheck?.ok || !freshAck} onClick={() => act(async () => {
            const route = await generateReturnRoute(NETWORK, dest);
            persist({ network: NETWORK, hlAddress: user, source: "unit-live", route, operations: {}, shielding: "not_delivered" });
          })}>Get verified Unit return address</button>
        </>)}
      </section>

      {rec && view && (
        <section className="panel">
          <h2>4. Send and follow: {view.state.replace(/_/g, " ")}</h2>
          <p>{view.explanation}</p>
          {view.stale && <div className="note warn">Last Unit poll failed ({rec.lastPollError?.message}). Showing last known state.</div>}
          {view.maySend && plan?.ok && mkt && (
            <button disabled={!signer || busy} onClick={() => confirm(`Send ${plan.sendAmount} ${mkt.base.name} to Unit ${rec.route.unitHlAddress} for ${rec.route.destination}? Estimated net ${zec(plan.estNetZat)}. This cannot be undone.`)
              && act(() => submitReturnSend({ spotSend: (p) => hl.exchange!.spotSend(p), userNonFundingLedgerUpdates: (p) => hl.info.userNonFundingLedgerUpdates(p) }, rec, persist, { token: mkt.tokenSelector, amount: plan.sendAmount }))}>
              Send {plan.sendAmount} {mkt.base.name} to Unit
            </button>)}
          {view.state === "outcome_unknown" && <button disabled={busy} onClick={() => act(() => reconcileReturnSend(hl.info, rec, persist))}>Reconcile with Hyperliquid ledger</button>}
          {view.state === "delivered_transparent" && (<div className="note ok">
            <b>Delivered to your Zcash wallet — open the wallet and shield.</b> Zodl shows a prompt to shield transparent funds; this app cannot see your wallet.<br />
            <button onClick={() => persist(markShielding(rec, "user_marked_shielded"))}>I shielded it in my wallet</button> (recorded as “you marked this shielded”, not as wallet evidence)
          </div>)}
          {rec.send && <details className="mono"><summary>Send record ({rec.send.evidence ?? "no exchange evidence"})</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(rec.send, null, 2)}</pre></details>}
          {view.operations.map((o) => <details key={o.operationId} className="mono"><summary>Unit {o.operationId}: {o.state}</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(o, null, 2)}</pre></details>)}
          {(view.state === "return_token_ready" || view.state === "recoverable_error") && !rec.send && <p><button onClick={() => { if (confirm("Forget this verified route? Nothing has been sent.")) { kv()?.removeItem(`return:v1:${NETWORK}:unit-live:${user.toLowerCase()}`); setRec(null); } }}>Use a different destination</button></p>}
        </section>
      )}

      {snap && (
        <section className="panel">
          <h2>Where every balance is</h2>
          <table className="mono"><tbody>
            {lines.map((l, i) => <tr key={i}><td>{l.bucket}</td><td>{l.asset}</td><td>{l.amount}</td><td>{l.note}</td></tr>)}
          </tbody></table>
          <p>{fullyAccounted(lines) ? "Every balance is accounted for." : <b>Some funds are in an unknown state: reconcile before doing anything else.</b>}</p>
          <p style={{ fontSize: 13 }}>Without this site: <code>tsx recovery/recover.ts {NETWORK} {user}</code> reads balances and Unit operations.</p>
        </section>
      )}
    </main>
  );
}
