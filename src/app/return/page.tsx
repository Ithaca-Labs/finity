"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { privateKeyToAccount } from "viem/accounts";
import { Star } from "@/components/brand";
import type { Network } from "@/lib/bridge/guardians";
import { createHl, type Hl } from "@/lib/hl/client";
import { persistentNonceManager } from "@/lib/hl/orders";
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

const NETWORK: Network = "testnet"; // mainnet return is disabled in this prototype
const kv = () => { try { return window.localStorage; } catch { return undefined; } };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const zec = (z: bigint) => formatZecAmount(z) + " ZEC";

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

  const zecName = mkt?.base.name ?? "ZEC";
  const closed = !!snap && exposure.length === 0 && snap.openOrders.length === 0;
  const steps = view ? returnSteps(view.state) : null;
  const done = view && ["user_marked_shielded", "wallet_confirmed_shielded"].includes(view.state);

  return (
    <main className="page-narrow">
      <header className="page-head">
        <span className="eyebrow"><Star /> Step 3 of 3 · Return</span>
        <h1>Bring your ZEC <em>home</em></h1>
        <p className="lede">Send ZEC from your trading account back to your Zcash wallet, then shield it with one tap. We track every coin until it&apos;s back with you.</p>
        <span className="banner"><i />Testnet preview · mainnet return is off</span>
      </header>

      <div className="stack">
        <div className="callout warn"><span className="callout-mark">i</span>
          <div>
            <b>Where testing stands (8 Oct)</b>
            <span>The bridge creates and signs return addresses for fresh <code>tm…</code> addresses (verified 3/3 against pinned keys). No testnet ZEC has reached this account yet, so <b>no real return has been sent or delivered</b>. The send step is live code that hasn&apos;t been run with funds.</span>
          </div>
        </div>
        {err && <div className="callout bad"><span className="callout-mark">!</span><div><b>Something went wrong</b><span>{err}</span></div></div>}

        <section className="card">
          <div className="card-head">
            <span className="card-n" data-done={signer ? "" : undefined}>{signer ? "✓" : "1"}</span>
            <div><h2>{signer ? "Account unlocked" : "Unlock your account"}</h2><p className="card-sub">Your trading key stays in this tab&apos;s memory only. Leave it empty to just look.</p></div>
            <span className={`badge ${signer ? "good" : "ink"}`}><i />{signer ? "Can send" : "View only"}</span>
          </div>
          <label className="field">
            <span className="field-label">Trading key</span>
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="0x…" />
          </label>
          {signer ? <div className="addr"><code>{user}</code></div> : (
            <label className="field">
              <span className="field-label">Or view an address</span>
              <input value={readAddr} onChange={(e) => setReadAddr(e.target.value.trim())} spellCheck={false} />
            </label>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <span className="card-n" data-done={closed ? "" : undefined}>{closed ? "✓" : "2"}</span>
            <div><h2>Wrap up trading</h2><p className="card-sub">Close what you want to close, then buy ZEC back with your USDC on Trade.</p></div>
          </div>
          {!snap ? <div className="empty">Checking your account…</div> : closed ? (
            <div className="callout ok"><span className="callout-mark">✓</span><div><span>No open positions or orders.</span></div></div>
          ) : (
            <div className="callout"><span className="callout-mark">i</span>
              <div>
                <b>Still open: {exposure.map((p: any) => `${p.position.coin} ${p.position.szi}`).join(", ") || "no positions"}{snap.openOrders.length ? `, ${snap.openOrders.length} order(s)` : ""}</b>
                <span>You can return without closing; only free {zecName} is sent. Closing is never blocked.</span>
              </div>
            </div>
          )}
          <Link className="btn btn-ghost btn-block" href="/trade">Go to Trade to close or buy {zecName} →</Link>
          <p className="small muted">Buying back is a price-capped swap with Hyperliquid&apos;s 10 USDC minimum. Only what actually fills counts below.</p>
        </section>

        <section className="card">
          <div className="card-head"><span className="card-n">3</span><div><h2>What can come home</h2><p className="card-sub">Free {zecName} in your account, after the bridge&apos;s fee.</p></div></div>
          <div className="stats">
            <div className="stat"><span>Available</span><strong>{snap ? avail : "—"}</strong><small>{zecName}{hold ? ` · ${hold} on hold` : ""}</small></div>
            {plan?.ok && <div className="stat"><span>You&apos;ll receive about</span><strong>{formatZecAmount(plan.estNetZat)}</strong><small>ZEC, before Zcash network fees</small></div>}
          </div>
          {fees && (
            <div className="facts">
              <div><span>Bridge fee</span><b>{zec(fees.withdrawalFeeZat)}</b></div>
              <div><span>Arrives in</span><b>{fees.withdrawalEta}</b></div>
              <div><span>Minimum</span><b>0.07 ZEC</b></div>
            </div>
          )}
          {plan && !plan.ok && (
            <div className="callout warn"><span className="callout-mark">!</span>
              <div><b>{plan.reason}</b>
                {plan.kind !== "fee_exceeds" && <ul>{residualOptions({ residualZat: plan.residualZat, usdcAvailable: usdcSpot, zecPx: snap?.mid ?? null }).map((o) => <li key={o}>{o}</li>)}</ul>}</div>
            </div>
          )}
          <details className="more">
            <summary>Fee details</summary>
            <ul>
              {fees && <li>Fee fetched {fees.fetchedAt}. Hyperliquid may also charge a 1 USDC activation fee if the bridge address is new.</li>}
              {mkt && <li>{mkt.base.name} {mkt.base.tokenId} (by ID), sent with selector {mkt.tokenSelector}.</li>}
            </ul>
          </details>
        </section>

        <section className="card">
          <div className="card-head">
            <span className="card-n" data-done={rec ? "" : undefined}>{rec ? "✓" : "4"}</span>
            <div><h2>Where to send it</h2><p className="card-sub">A brand-new transparent address from your own Zcash wallet. You&apos;ll shield it once it lands.</p></div>
            {rec && <span className="badge good"><i />{rec.route.verification.verifiedCount}/3 guardians verified</span>}
          </div>
          {rec ? (<>
            <div className="field"><span className="field-label">Your Zcash address</span><div className="addr"><code>{rec.route.destination}</code></div></div>
            <details className="more"><summary>Route details</summary><ul><li>Via bridge address {rec.route.unitHlAddress} on Hyperliquid.</li><li>Guardians: {rec.route.verification.verifiedCount}/3 signatures valid against pinned {rec.network} keys.</li></ul></details>
          </>) : (<>
            <label className="field">
              <span className="field-label">Fresh receive address ({NETWORK === "testnet" ? "tm…" : "t1…"})</span>
              <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder={NETWORK === "testnet" ? "tm…" : "t1…"} spellCheck={false} />
            </label>
            {destCheck && !destCheck.ok && <div className="callout bad"><span className="callout-mark">!</span><div><span>{destCheck.reason}</span></div></div>}
            <label className="check">
              <input type="checkbox" checked={freshAck} onChange={(e) => setFreshAck(e.target.checked)} />
              <span>This is a fresh address from my own wallet.<small>I just generated it and haven&apos;t used it before. I understand the payout to it is public on Zcash.</small></span>
            </label>
            <button className="btn-lg btn-block" disabled={busy || !destCheck?.ok || !freshAck} onClick={() => act(async () => {
              const route = await generateReturnRoute(NETWORK, dest);
              persist({ network: NETWORK, hlAddress: user, source: "unit-live", route, operations: {}, shielding: "not_delivered" });
            })}>Verify and continue</button>
          </>)}
        </section>

        {!rec || !view || !steps ? (
          <section className="card" data-dim="">
            <div className="card-head"><span className="card-n">5</span><div><h2>Send and track</h2><p className="card-sub">Once your address is verified, you&apos;ll send from here and follow it home.</p></div></div>
          </section>
        ) : (
          <section className="card">
            <div className="card-head">
              <span className="card-n" data-done={done ? "" : undefined}>{done ? "✓" : "5"}</span>
              <div><h2>{RETURN_TITLE[view.state]}</h2><p className="card-sub">{view.explanation}</p></div>
            </div>
            {view.stale && <div className="callout warn"><span className="callout-mark">!</span><div><b>Showing the last known status</b><span>The latest check failed ({rec.lastPollError?.message}). Nothing has been lost.</span></div></div>}
            <ol className="tracker">
              <li data-s={steps[0]}><span className="tracker-dot">{steps[0] === "done" && "✓"}</span><div><b>Sent to the bridge</b><small>From your Hyperliquid account</small></div></li>
              <li data-s={steps[1]}><span className="tracker-dot">{steps[1] === "done" && "✓"}</span><div><b>On its way to Zcash</b><small>{fees ? `About ${fees.withdrawalEta}` : "About two hours"}</small></div></li>
              <li data-s={steps[2]}><span className="tracker-dot">{steps[2] === "done" && "✓"}</span><div><b>In your wallet</b><small>Delivered to your transparent address</small></div></li>
              <li data-s={steps[3]}><span className="tracker-dot">{steps[3] === "done" && "✓"}</span><div><b>Shielded</b><small>{view.state === "user_marked_shielded" ? "You marked this shielded" : "One tap in your wallet"}</small></div></li>
            </ol>
            {view.maySend && plan?.ok && mkt && (
              <button className="btn-lg btn-block" disabled={!signer || busy} onClick={() => confirm(`Send ${plan.sendAmount} ${mkt.base.name} to Unit ${rec.route.unitHlAddress} for ${rec.route.destination}? Estimated net ${zec(plan.estNetZat)}. This cannot be undone.`)
                && act(() => submitReturnSend({ spotSend: (p) => hl.exchange!.spotSend(p), userNonFundingLedgerUpdates: (p) => hl.info.userNonFundingLedgerUpdates(p) }, rec, persist, { token: mkt.tokenSelector, amount: plan.sendAmount }))}>
                Send {plan.sendAmount} {mkt.base.name} home
              </button>)}
            {view.state === "outcome_unknown" && (
              <div className="callout bad"><span className="callout-mark">!</span>
                <div><b>Don&apos;t send again yet</b><span>We need to check Hyperliquid&apos;s records to see whether the send went through.</span>
                  <div className="btn-row"><button className="btn-sm" disabled={busy} onClick={() => act(() => reconcileReturnSend(hl.info, rec, persist))}>Check now</button></div></div>
              </div>
            )}
            {view.state === "delivered_transparent" && (
              <div className="callout ok"><span className="callout-mark">✓</span>
                <div><b>It&apos;s in your wallet. Open it and shield.</b><span>Zodl shows a prompt to shield transparent funds. finity can&apos;t see your wallet, so let us know once you&apos;ve done it.</span>
                  <div className="btn-row"><button className="btn-sm" onClick={() => persist(markShielding(rec, "user_marked_shielded"))}>I shielded it</button></div>
                  <small className="muted">Recorded as &quot;you marked this shielded&quot;, not as wallet evidence.</small></div>
              </div>
            )}
            {(view.state === "return_token_ready" || view.state === "recoverable_error") && !rec.send && (
              <button className="text-link" onClick={() => { if (confirm("Forget this verified route? Nothing has been sent.")) { kv()?.removeItem(`return:v1:${NETWORK}:unit-live:${user.toLowerCase()}`); setRec(null); } }}>Use a different address</button>
            )}
            {(rec.send || view.operations.length > 0) && (
              <details className="more">
                <summary>Transfer records</summary>
                {rec.send && <><p className="small muted">Send record ({rec.send.evidence ?? "no exchange evidence"})</p><pre>{JSON.stringify(rec.send, null, 2)}</pre></>}
                {view.operations.map((o) => <div key={o.operationId}><p className="small muted">Bridge operation {o.operationId}: {o.state}</p><pre>{JSON.stringify(o, null, 2)}</pre></div>)}
              </details>
            )}
          </section>
        )}

        {snap && (
          <section className="card">
            <div className="card-head">
              <div><h2>Where your money is</h2><p className="card-sub">Every balance, in exactly one place.</p></div>
              <span className={`badge ${fullyAccounted(lines) ? "good" : "bad"}`}><i />{fullyAccounted(lines) ? "All accounted for" : "Needs a check"}</span>
            </div>
            {!fullyAccounted(lines) && <div className="callout bad"><span className="callout-mark">!</span><div><span>Some funds are in an unknown state. Check before doing anything else.</span></div></div>}
            {lines.length === 0 ? <div className="empty">No balances yet.</div> : (
              <div className="rows">
                {lines.map((l, i) => (
                  <div className="row" key={i}>
                    <div className="row-main"><b>{l.amount} {l.asset}</b><small style={{ fontFamily: "inherit" }}>{l.note}</small></div>
                    <span className={`badge ${BUCKET[l.bucket][1]}`}>{BUCKET[l.bucket][0]}</span>
                  </div>
                ))}
              </div>
            )}
            <details className="more"><summary>Check without finity</summary><p className="small muted">Run <code>tsx recovery/recover.ts {NETWORK} {user}</code> to read balances and bridge operations directly.</p></details>
          </section>
        )}
      </div>
    </main>
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

type Step = "done" | "active" | "todo" | "bad";
function returnSteps(s: ReturnState): [Step, Step, Step, Step] {
  switch (s) {
    case "return_token_ready": case "send_pending": return ["active", "todo", "todo", "todo"];
    case "outcome_unknown": case "recoverable_error": return ["bad", "todo", "todo", "todo"];
    case "bridge_return_pending": return ["done", "active", "todo", "todo"];
    case "manual_recovery": return ["done", "bad", "todo", "todo"];
    case "delivered_transparent": return ["done", "done", "done", "active"];
    default: return ["done", "done", "done", "done"];
  }
}
