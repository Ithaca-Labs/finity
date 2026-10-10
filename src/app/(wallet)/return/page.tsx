"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import type { Network } from "@/lib/bridge/guardians";
import { createHl } from "@/lib/hl/client";
import { availableSpot, resolveSpot, type SpotMarket } from "@/lib/hl/spot";
import { UNIT_ZEC_TOKEN_ID } from "@/lib/hl/xzec";
import { UnitBridgeAdapter, type ZcashFees } from "@/lib/bridge/unit";
import {
  checkReturnDestination, deriveReturn, generateReturnRoute, markShielding, mergeReturnOperations, planReturn,
  reconcileReturnSend, residualOptions, submitReturnSend, type ReturnRecord, type ReturnState,
} from "@/lib/bridge/returns";
import { deriveFunding } from "@/lib/bridge/funding";
import { accountBalances, fullyAccounted, type Bucket } from "@/lib/accounting";
import { loadFunding, loadReturn, saveReturn } from "@/lib/store/funding-store";
import { formatZecAmount } from "@/lib/zcash/address";
import { DoneMark } from "@/components/sketch";
import { short, useAccount } from "@/components/wallet/account";
import { Callout, FlowHead, Icon, StepView, Ticker, Tracker, type StepState } from "@/components/wallet/ui";

const NETWORK: Network = "testnet"; // mainnet return is disabled in this prototype
const kv = () => { try { return window.localStorage; } catch { return undefined; } };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const zec = (z: bigint) => formatZecAmount(z) + " ZEC";

type Snap = { perps: any; spot: any[]; openOrders: any[]; weiDecimals: number; mid: number | null };
const FLOW = ["amount", "to", "send", "track"] as const;
type Step = (typeof FLOW)[number];
const TITLES: Record<Step, string> = { amount: "Send ZEC home", to: "Where to?", send: "Review", track: "Return status" };

export default function Return() {
  const { acct, user, valid, setSheet } = useAccount();
  const c = acct.clients;
  const signer = !!c;
  // Returns move funds, so they are signed by the account key, never the trading key.
  const readOnly = useMemo(() => createHl(NETWORK), []);
  const hl = c?.owner ?? readOnly;

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

  // ---- flow ----
  const zecName = mkt?.base.name ?? "ZEC";
  const closed = !!snap && exposure.length === 0 && snap.openOrders.length === 0;
  const steps = view ? returnSteps(view.state) : null;
  const done = view && ["user_marked_shielded", "wallet_confirmed_shielded"].includes(view.state);
  const [step, setStep] = useState<Step>("amount");
  const [dir, setDir] = useState(1);
  const go = (s: Step) => { setDir(FLOW.indexOf(s) >= FLOW.indexOf(step) ? 1 : -1); setStep(s); };
  // A verified route jumps ahead to review; anything already sent goes straight to status.
  const placed = useRef<string | null>(null);
  useEffect(() => {
    const k = rec ? (rec.send ? "track" : "send") : "amount";
    if (placed.current === `${user}:${k}`) return;
    placed.current = `${user}:${k}`;
    setDir(1); setStep(k);
  }, [rec, user]);
  const back = step === "to" ? () => go("amount") : step === "send" && !rec?.send ? () => go("to") : undefined;

  return (
    <div className="flow">
      <FlowHead title={TITLES[step]} step={FLOW.indexOf(step)} total={FLOW.length} onBack={back} />
      {err && <Callout tone="bad" title="Something went wrong">{err}</Callout>}

      <StepView k={step} dir={dir}>
        {step === "amount" && (
          <div className="stack">
            <div className="amount-hero">
              <span className="eyebrow">Free to send home</span>
              <div className="amount-hero-num"><Ticker value={avail} decimals={4} /><span>{zecName}</span></div>
              {plan?.ok ? <p>You&apos;ll receive about <b>{formatZecAmount(plan.estNetZat)} ZEC</b> in your wallet</p>
                : <p className="muted">{hold ? `${hold} on hold in open orders` : "Before Zcash network fees"}</p>}
            </div>
            {fees && (
              <div className="facts">
                <div><span>Bridge fee</span><b>{zec(fees.withdrawalFeeZat)}</b></div>
                <div><span>Arrives in</span><b>{fees.withdrawalEta}</b></div>
                <div><span>Minimum</span><b>0.07 ZEC</b></div>
              </div>
            )}
            {!snap ? null : closed ? (
              <Callout tone="ok">No open positions or orders.</Callout>
            ) : (
              <Callout title={`Still open: ${exposure.map((p: any) => `${p.position.coin} ${p.position.szi}`).join(", ") || "no positions"}${snap.openOrders.length ? `, ${snap.openOrders.length} order(s)` : ""}`}>
                You can send home without closing; only free {zecName} moves. Closing is never blocked.
              </Callout>
            )}
            {plan && !plan.ok && (
              <Callout tone="warn" title={plan.reason}>
                {plan.kind !== "fee_exceeds" && <ul>{residualOptions({ residualZat: plan.residualZat, usdcAvailable: usdcSpot, zecPx: snap?.mid ?? null }).map((o) => <li key={o}>{o}</li>)}</ul>}
              </Callout>
            )}
            <Link href="/trade?tab=swap" className="row-link"><span className="to-ic"><Icon name="swap" /></span><span><b>Buy {zecName} back with USDC</b><small>A price-capped swap; only what fills counts here</small></span><span className="chev">›</span></Link>
            <button type="button" className="btn btn-lg btn-block" onClick={() => go("to")}>Continue</button>
            <Callout tone="warn" title="Where testing stands (8 Oct)">
              The bridge creates and signs return addresses for fresh <code>tm…</code> addresses (verified 3/3 against pinned keys). No testnet ZEC has reached this account yet, so <b>no real return has been sent or delivered</b>. The send step is live code that hasn&apos;t been run with funds.
            </Callout>
          </div>
        )}

        {step === "to" && (
          <div className="stack">
            <div className="hero-ic"><Icon name="return" /></div>
            <p className="flow-lede">Paste a brand-new transparent address from your own Zcash wallet. You&apos;ll shield it once it lands.</p>
            <label className="field">
              <span className="field-label">Fresh receive address ({NETWORK === "testnet" ? "tm…" : "t1…"})</span>
              <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder={NETWORK === "testnet" ? "tm…" : "t1…"} spellCheck={false} aria-label="Zcash receive address" />
            </label>
            {destCheck && !destCheck.ok && <Callout tone="bad">{destCheck.reason}</Callout>}
            <label className="check">
              <input type="checkbox" checked={freshAck} onChange={(e) => setFreshAck(e.target.checked)} />
              <span>This is a fresh address from my own wallet.<small>I just generated it and haven&apos;t used it before. I understand the payout to it is public on Zcash.</small></span>
            </label>
            <button type="button" className="btn btn-lg btn-block" disabled={busy || !destCheck?.ok || !freshAck} onClick={() => act(async () => {
              const route = await generateReturnRoute(NETWORK, dest);
              persist({ network: NETWORK, hlAddress: user, source: "unit-live", route, operations: {}, shielding: "not_delivered" });
            })}>{busy && <span className="spinner" />}{busy ? "Verifying with the bridge…" : "Verify and continue"}</button>
          </div>
        )}

        {step === "send" && rec && view && (
          <div className="stack">
            <div className="review-card">
              <div className="review-line"><span>Sending</span><b>{plan?.ok ? `${plan.sendAmount} ${zecName}` : `${avail} ${zecName}`}</b></div>
              <div className="review-arrow"><Icon name="return" /></div>
              <div className="review-line"><span>To your wallet</span><b className="mono">{short(rec.route.destination)}</b></div>
              <div className="review-sep" />
              <div className="review-line small"><span>You receive about</span><b>{plan?.ok ? zec(plan.estNetZat) : "—"}</b></div>
              <div className="review-line small"><span>Bridge fee</span><b>{fees ? zec(fees.withdrawalFeeZat) : "—"}</b></div>
              <div className="review-line small"><span>Arrives in</span><b>{fees?.withdrawalEta ?? "—"}</b></div>
            </div>
            <span className="badge good center"><i />{rec.route.verification.verifiedCount}/3 guardians verified</span>
            {view.state === "recoverable_error" && <Callout tone="bad" title="The last send didn't go through">{view.explanation}</Callout>}
            {view.maySend && plan?.ok && mkt ? (
              !signer ? <button type="button" className="btn btn-lg btn-block" onClick={() => setSheet(true)}><Icon name="lock" />Create account to send</button> : (
                <button type="button" className="btn btn-lg btn-block" disabled={busy} onClick={() => confirm(`Send ${plan.sendAmount} ${mkt.base.name} to Unit ${rec.route.unitHlAddress} for ${rec.route.destination}? Estimated net ${zec(plan.estNetZat)}. This cannot be undone.`)
                  && act(() => submitReturnSend({ spotSend: (p) => hl.exchange!.spotSend(p), userNonFundingLedgerUpdates: (p) => hl.info.userNonFundingLedgerUpdates(p) }, rec, persist, { token: mkt.tokenSelector, amount: plan.sendAmount }))}>
                  {busy && <span className="spinner" />}Send {plan.sendAmount} {mkt.base.name} home
                </button>
              )
            ) : <Callout tone="warn">Nothing sendable yet. Buy {zecName} back on Trade first.</Callout>}
            {!rec.send && <button type="button" className="text-link" onClick={() => { if (confirm("Forget this verified route? Nothing has been sent.")) { kv()?.removeItem(`return:v1:${NETWORK}:unit-live:${user.toLowerCase()}`); setRec(null); placed.current = null; } }}>Use a different address</button>}
            <details className="more"><summary>Route details</summary><ul><li>To {rec.route.destination}</li><li>Via bridge address {rec.route.unitHlAddress} on Hyperliquid.</li><li>Guardians: {rec.route.verification.verifiedCount}/3 signatures valid against pinned {rec.network} keys.</li></ul></details>
          </div>
        )}

        {step === "track" && rec && view && steps && (
          <div className="stack">
            {done ? (
              <div className="done">
                <DoneMark className="done-mark" />
                <h2>Home and shielded</h2>
                <p>{view.explanation}</p>
                <Link href="/wallet" className="btn btn-lg btn-block">Back to wallet</Link>
              </div>
            ) : (<>
              <div className="status-head"><h2>{RETURN_TITLE[view.state]}</h2><p>{view.explanation}</p></div>
              {view.stale && <Callout tone="warn" title="Showing the last known status">The latest check failed ({rec.lastPollError?.message}). Nothing has been lost.</Callout>}
              <Tracker items={[
                { s: steps[0], title: "Sent to the bridge", sub: "From your Hyperliquid account" },
                { s: steps[1], title: "On its way to Zcash", sub: fees ? `About ${fees.withdrawalEta}` : "About two hours" },
                { s: steps[2], title: "In your wallet", sub: "Delivered to your transparent address" },
                { s: steps[3], title: "Shielded", sub: "One tap in your wallet" },
              ]} />
              {view.state === "outcome_unknown" && (
                <Callout tone="bad" title="Don't send again yet">
                  We need to check Hyperliquid&apos;s records to see whether the send went through.
                  <div className="btn-row"><button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(() => reconcileReturnSend(hl.info, rec, persist))}>Check now</button></div>
                </Callout>
              )}
              {view.state === "delivered_transparent" && (
                <Callout tone="ok" title="It's in your wallet. Open it and shield.">
                  Zodl shows a prompt to shield transparent funds. finity can&apos;t see your wallet, so tell us once you&apos;ve done it.
                  <div className="btn-row"><button type="button" className="btn btn-sm" onClick={() => persist(markShielding(rec, "user_marked_shielded"))}>I shielded it</button></div>
                  <small className="muted">Recorded as &quot;you marked this shielded&quot;, not as wallet evidence.</small>
                </Callout>
              )}
              {view.maySend && <button type="button" className="btn btn-ghost btn-block" onClick={() => go("send")}>Back to review</button>}
            </>)}
            {(rec.send || view.operations.length > 0) && (
              <details className="more">
                <summary>Transfer records</summary>
                {rec.send && <><p className="small muted">Send record ({rec.send.evidence ?? "no exchange evidence"})</p><pre>{JSON.stringify(rec.send, null, 2)}</pre></>}
                {view.operations.map((o) => <div key={o.operationId}><p className="small muted">Bridge operation {o.operationId}: {o.state}</p><pre>{JSON.stringify(o, null, 2)}</pre></div>)}
              </details>
            )}
          </div>
        )}
      </StepView>

      {snap && (
        <motion.details className="ledger" initial={{ opacity: 0 }} animate={{ opacity: 1 }} open={!fullyAccounted(lines)}>
          <summary>
            <span><b>Where your money is</b><small>Every balance, in exactly one place</small></span>
            <span className={`badge ${fullyAccounted(lines) ? "good" : "bad"}`}><i />{fullyAccounted(lines) ? "All accounted for" : "Needs a check"}</span>
          </summary>
          {!fullyAccounted(lines) && <Callout tone="bad">Some funds are in an unknown state. Check before doing anything else.</Callout>}
          {lines.length === 0 ? <p className="small muted">No balances yet.</p> : (
            <div className="list">
              {lines.map((l, i) => (
                <div className="token-row" key={i}>
                  <div className="token-main"><b>{l.amount} {l.asset}</b><small>{l.note}</small></div>
                  <span className={`badge ${BUCKET[l.bucket][1]}`}>{BUCKET[l.bucket][0]}</span>
                </div>
              ))}
            </div>
          )}
          <p className="small muted">Without finity: <code>tsx recovery/recover.ts {NETWORK} {user}</code> reads balances and bridge operations directly.</p>
        </motion.details>
      )}
    </div>
  );
}

const BUCKET: Record<Bucket, [string, string]> = {
  user_control: ["Yours", "good"],
  bridge_operation: ["In transit", "ink"],
  residual: ["Leftover", "warn"],
  manual_recovery: ["Needs recovery", "bad"],
  unaccounted: ["Unknown", "bad"],
};

const RETURN_TITLE: Record<ReturnState, string> = {
  return_token_ready: "Ready to send",
  send_pending: "Sending…",
  outcome_unknown: "Checking your send",
  recoverable_error: "The send didn't go through",
  bridge_return_pending: "On its way home",
  delivered_transparent: "Arrived. Now shield it",
  user_marked_shielded: "Home and shielded",
  wallet_confirmed_shielded: "Home and shielded",
  manual_recovery: "Needs attention",
};

function returnSteps(s: ReturnState): [StepState, StepState, StepState, StepState] {
  switch (s) {
    case "return_token_ready": case "send_pending": return ["active", "todo", "todo", "todo"];
    case "outcome_unknown": case "recoverable_error": return ["bad", "todo", "todo", "todo"];
    case "bridge_return_pending": return ["done", "active", "todo", "todo"];
    case "manual_recovery": return ["done", "bad", "todo", "todo"];
    case "delivered_transparent": return ["done", "done", "done", "active"];
    default: return ["done", "done", "done", "done"];
  }
}
