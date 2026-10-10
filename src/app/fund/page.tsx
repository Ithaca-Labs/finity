"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Star } from "@/components/brand";
import type { Network } from "@/lib/bridge/guardians";
import { UnitBridgeAdapter, checkFundingAmount, crossCheckMapping, type BridgeAdapter, type VerifiedDeposit, type ZcashFees } from "@/lib/bridge/unit";
import { deriveFunding, mergeOperations, recordPollError, opPhase, type FundingRecord, type FundingState } from "@/lib/bridge/funding";
import { ReplayBridgeAdapter, REPLAY_SCENARIOS, type ReplayScenario } from "@/lib/replay/unit-replay";
import { buildZip321, formatZecAmount, zecToZatoshis } from "@/lib/zcash/address";
import { loadFunding, saveFunding } from "@/lib/store/funding-store";
import { unitZecBalance } from "@/lib/hl/xzec";

const NETWORK: Network = "testnet"; // mainnet funding is disabled in this prototype
type Lane = "unit-live" | ReplayScenario;
const kv = () => { try { return window.localStorage; } catch { return undefined; } };
const zec = (z: bigint) => formatZecAmount(z) + " ZEC";


export default function Fund() {
  const [lane, setLane] = useState<Lane>("unit-live");
  const [hl, setHl] = useState("0x1f20B96A9fde5218ED05A212B2d23093100785c0");
  const [recoveryOk, setRecoveryOk] = useState(false);
  const [dep, setDep] = useState<VerifiedDeposit | null>(null);
  const [mapNote, setMapNote] = useState<string>("");
  const [fees, setFees] = useState<ZcashFees | null>(null);
  const [amount, setAmount] = useState("0.1");
  const [consent, setConsent] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [rec, setRec] = useState<FundingRecord | null>(null);
  const [balance, setBalance] = useState<{ total: number; label: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const adapter = useRef<BridgeAdapter | null>(null);

  const isReplay = lane !== "unit-live";
  const validHl = /^0x[0-9a-fA-F]{40}$/.test(hl);

  // New lane or account: fresh adapter, reload any persisted record for it.
  useEffect(() => {
    adapter.current = isReplay ? new ReplayBridgeAdapter(NETWORK, lane as ReplayScenario) : new UnitBridgeAdapter(NETWORK);
    setDep(null); setQr(null); setConsent(false); setErr(null); setBalance(null);
    setRec(validHl ? loadFunding(kv(), { network: NETWORK, hlAddress: hl, source: adapter.current.source }) : null);
  }, [lane, hl, isReplay, validHl]);

  const persist = useCallback((r: FundingRecord) => { setRec(r); saveFunding(kv(), r); }, []);

  async function generate() {
    setErr(null);
    try {
      const a = adapter.current!;
      const [d, f] = await Promise.all([a.generateDeposit(hl as `0x${string}`), a.fees()]);
      let note = "";
      try { const { addresses } = await a.operations(hl as `0x${string}`); const c = crossCheckMapping(d, addresses); if (!c.ok) throw new Error(c.note); note = c.note; }
      catch (e) { if (e instanceof Error && /differs/.test(e.message)) throw e; note = "Could not cross-check /operations right now"; }
      setDep(d); setFees(f); setMapNote(note);
      persist(rec ?? { network: NETWORK, hlAddress: hl, payAddress: d.payAddress, source: d.source, operations: {} });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const view = useMemo(() => (rec ? deriveFunding(rec, balance?.total ?? null) : null), [rec, balance]);
  const amountZat = useMemo(() => { try { return zecToZatoshis(amount); } catch { return null; } }, [amount]);
  const check = fees && amountZat !== null ? checkFundingAmount(amountZat, fees) : null;
  const canShowQr = !!dep && recoveryOk && consent && check?.ok && view?.mayShowPaymentRequest;

  useEffect(() => {
    if (!canShowQr || !dep || amountZat === null) { setQr(null); return; }
    QRCode.toDataURL(buildZip321(dep.payAddress, NETWORK, amountZat), { margin: 1, width: 240 }).then(setQr).catch((e) => setErr(String(e)));
  }, [canShowQr, dep, amountZat]);

  // Poll Unit and HL. Errors are recorded, never treated as "no deposit".
  useEffect(() => {
    if (!rec) return;
    let stop = false;
    const tick = async () => {
      const a = adapter.current!;
      try {
        const { operations } = await a.operations(rec.hlAddress as `0x${string}`);
        if (!stop) persist(mergeOperations(loadFunding(kv(), rec) ?? rec, operations));
      } catch (e) { if (!stop) persist(recordPollError(loadFunding(kv(), rec) ?? rec, e instanceof Error ? e.message : String(e))); }
      try {
        if (a.source === "replay") {
          const r = loadFunding(kv(), rec);
          const done = r && Object.values(r.operations).some((o) => o.state === "done");
          setBalance({ total: done ? 0.09418572 : 0, label: "replay (synthetic)" });
        } else {
          const b = await unitZecBalance(NETWORK, rec.hlAddress);
          setBalance({ total: b.total, label: `${b.token} (token ${b.index}), live HL testnet` });
        }
      } catch { /* balance stays unknown (null) rather than zero */ }
    };
    tick();
    const id = setInterval(tick, isReplay ? 2000 : 15000);
    return () => { stop = true; clearInterval(id); };
  }, [rec?.hlAddress, rec?.source, isReplay, persist]); // eslint-disable-line react-hooks/exhaustive-deps

  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(dep!.payAddress); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  const confs = view ? Math.max(0, ...view.operations.map((o) => o.sourceTxConfirmations ?? 0)) : 0;
  const steps = view ? fundSteps(view.state, view.operations.length > 0 && view.operations.every((o) => opPhase(o) === "done")) : null;
  const tone = view && ["below_minimum_stuck", "manual_recovery"].includes(view.state) ? "bad" : view?.state === "recoverable_error" ? "warn" : null;

  return (
    <main className="page-narrow">
      <header className="page-head">
        <span className="eyebrow"><Star /> Step 1 of 3 · Fund</span>
        <h1>Add <em>ZEC</em> to your trading account</h1>
        <p className="lede">Send shielded ZEC from your Zcash wallet. It arrives in a fresh Hyperliquid account in about two hours, ready to trade.</p>
        <span className="banner"><i />Testnet preview · no real funds · mainnet funding is off</span>
      </header>

      <div className="stack">
        {isReplay && (
          <div className="callout bad"><span className="callout-mark">!</span>
            <div><b>Simulation mode ({lane})</b><span>Everything on this screen is simulated from a recorded fixture. Nothing here is a real transfer.</span></div>
          </div>
        )}

        <section className="card">
          <div className="card-head">
            <span className="card-n" data-done={dep ? "" : undefined}>{dep ? "✓" : "1"}</span>
            <div><h2>Your trading account</h2><p className="card-sub">The fresh Hyperliquid account your ZEC will land in. Only you hold its key.</p></div>
          </div>
          <label className="field">
            <span className="field-label">Hyperliquid account address</span>
            <input value={hl} onChange={(e) => setHl(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
            {hl && !validHl && <span className="field-hint" style={{ color: "var(--bad)" }}>That doesn&apos;t look like a Hyperliquid address (0x + 40 characters).</span>}
          </label>
          <label className="check">
            <input type="checkbox" checked={recoveryOk} onChange={(e) => setRecoveryOk(e.target.checked)} />
            <span>I can reach this account without finity.<small>I&apos;ve checked the recovery client (<code>recovery/recover.ts</code>) can read and control it if this site disappears.</small></span>
          </label>
          <button className="btn-lg btn-block" disabled={!validHl} onClick={generate}>{dep ? "Refresh deposit address" : "Get my deposit address"}</button>
          <details className="more">
            <summary>Developer options</summary>
            <label className="field">
              <span className="field-label">Data source</span>
              <select value={lane} onChange={(e) => setLane(e.target.value as Lane)}>
                <option value="unit-live">Unit testnet (live)</option>
                {REPLAY_SCENARIOS.map((s) => <option key={s} value={s}>Simulation: {s}</option>)}
              </select>
            </label>
          </details>
        </section>

        {err && <div className="callout bad"><span className="callout-mark">!</span><div><b>Something went wrong</b><span>{err}</span></div></div>}

        {!dep || !fees ? (
          <section className="card" data-dim="">
            <div className="card-head"><span className="card-n">2</span><div><h2>Send ZEC</h2><p className="card-sub">Your verified deposit address and QR code will appear here.</p></div></div>
          </section>
        ) : (
          <section className="card">
            <div className="card-head">
              <span className="card-n">2</span>
              <div><h2>Send ZEC</h2><p className="card-sub">Pay this address once from your Zcash wallet. We&apos;ll follow it from here.</p></div>
              <span className="badge good"><i />{dep.verification.verifiedCount}/3 guardians verified</span>
            </div>
            <div className="facts">
              <div><span>Minimum</span><b>0.07 ZEC</b></div>
              <div><span>Bridge fee</span><b>{zec(fees.depositFeeZat)}</b></div>
              <div><span>Arrives in</span><b>{fees.depositEta}</b></div>
            </div>
            {view?.mayShowPaymentRequest ? (<>
              <label className="field">
                <span className="field-label">Amount to send</span>
                <div className="amount">
                  <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.trim()); setConsent(false); }} aria-label="Amount in ZEC" />
                  <span className="amount-unit">ZEC</span>
                </div>
              </label>
              {check && !check.ok && <div className="callout bad"><span className="callout-mark">!</span><div><span>{check.reason}</span></div></div>}
              {check?.ok && <div className="amount-foot"><span>You&apos;ll receive about</span><b>{zec(check.estNetZat)}</b></div>}
              <label className="check">
                <input type="checkbox" checked={consent} disabled={!check?.ok} onChange={(e) => setConsent(e.target.checked)} />
                <span>I understand how this works.<small>It takes about 2 hours, fees apply, the bridge step is publicly visible, and the Unit bridge (not finity) holds the backing ZEC.</small></span>
              </label>
              {!recoveryOk && <p className="small muted">Tick the recovery check in step 1 to see your payment code.</p>}
              {qr && (
                <div className="qr">
                  <img src={qr} alt="ZIP-321 payment request" width={240} height={240} />
                  <div>
                    <p>Scan with a testnet Zcash wallet and send <b>exactly {amount} ZEC</b>, once.</p>
                    <div className="addr"><code>{dep.payAddress}</code><button className="btn-sm btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button></div>
                  </div>
                </div>
              )}
            </>) : (
              <div className="callout warn"><span className="callout-mark">!</span>
                <div><b>Don&apos;t send again</b><span>A deposit is already on its way, or the bridge can&apos;t be reached right now. Track it below.</span></div>
              </div>
            )}
            <details className="more">
              <summary>How this address was checked</summary>
              <ul>
                <li>{dep.payKind === "tex" ? "TEX address: your wallet unshields to a one-time transparent address first (ZIP 320)." : "Transparent P2PKH address."} Network: {dep.network}.</li>
                <li>{dep.verification.verifiedCount} of 3 guardian signatures valid against pinned {dep.network} keys (2 required).</li>
                <li>Mapping cross-check: {mapNote}</li>
                <li>Fee fetched {fees.fetchedAt}{fees.source === "replay" && " (replayed snapshot)"}; ETA covers 100 Zcash confirmations.</li>
                <li>Deposits under 0.07 ZEC get stuck and are only reprocessed if Unit lowers its minimum.</li>
                <li>ZEC arrives as a Hyperliquid spot token. Converting it to USDC is a separate step you confirm on Trade.</li>
              </ul>
            </details>
          </section>
        )}

        {view && rec && steps && (
          <section className="card">
            <div className="card-head">
              <span className="card-n" data-done={view.state === "unit_token_received" ? "" : undefined}>{view.state === "unit_token_received" ? "✓" : "3"}</span>
              <div><h2>{FUND_TITLE[view.state]}</h2><p className="card-sub">{view.explanation}</p></div>
            </div>
            {tone && <div className={`callout ${tone}`}><span className="callout-mark">!</span><div><b>{tone === "bad" ? "This deposit needs attention" : "Reconnecting"}</b><span>Keep this page's record. Nothing is lost; see the runbook if it doesn&apos;t clear.</span></div></div>}
            {view.stale && <div className="callout warn"><span className="callout-mark">!</span><div><b>Showing the last known status</b><span>The latest check failed ({rec.lastPollError?.message}). Nothing has been lost.</span></div></div>}
            <ol className="tracker">
              <li data-s={steps[0]}><span className="tracker-dot">{steps[0] === "done" && "✓"}</span><div><b>Payment sent</b><small>{steps[0] === "done" ? "We've spotted your Zcash transaction" : "Waiting to spot your Zcash transaction"}</small></div></li>
              <li data-s={steps[1]}><span className="tracker-dot">{steps[1] === "done" && "✓"}</span>
                <div><b>Confirming on Zcash</b><small>{confs ? `${Math.min(confs, 100)} of 100 confirmations` : "100 confirmations, about 2 hours"}</small>
                  {steps[1] === "active" && confs > 0 && <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${Math.min(confs, 100)}%` }} /></div>}</div></li>
              <li data-s={steps[2]}><span className="tracker-dot">{steps[2] === "done" && "✓"}</span><div><b>Ready to trade</b><small>ZEC lands in your Hyperliquid account</small></div></li>
            </ol>
            <div className="stats">
              <div className="stat"><span>ZEC in your account</span><strong>{balance ? balance.total : "—"}</strong><small>{balance ? balance.label : "Checking…"}</small></div>
            </div>
            {view.state === "unit_token_received" && <Link className="btn btn-lg btn-block" href="/trade">Continue to Trade →</Link>}
            <details className="more">
              <summary>Bridge records</summary>
              <p className="small muted">Source: {rec.source === "replay" ? "simulation fixture, not a bridge transfer" : "live Unit testnet API"}. Last good check {rec.lastPollOk ?? "never"}.</p>
              {view.operations.map((o) => (
                <div key={o.operationId + o.sourceTxHash}>
                  <p className="small mono">{o.sourceTxHash ?? o.operationId}: {o.state} ({opPhase(o)})</p>
                  <pre>{JSON.stringify(o, null, 2)}</pre>
                </div>
              ))}
            </details>
          </section>
        )}
      </div>
    </main>
  );
}

const FUND_TITLE: Record<FundingState, string> = {
  awaiting_deposit: "Waiting for your payment",
  deposit_seen: "Payment spotted",
  bridge_pending: "Confirming on Zcash",
  unit_token_received: "Your ZEC has arrived",
  below_minimum_stuck: "Deposit below the minimum",
  recoverable_error: "Can't reach the bridge",
  manual_recovery: "Needs attention",
};

type Step = "done" | "active" | "todo" | "bad";
function fundSteps(s: FundingState, bridgeDone: boolean): [Step, Step, Step] {
  switch (s) {
    case "awaiting_deposit": case "recoverable_error": return ["active", "todo", "todo"];
    case "deposit_seen": return ["done", "active", "todo"];
    case "bridge_pending": return bridgeDone ? ["done", "done", "active"] : ["done", "active", "todo"];
    case "unit_token_received": return ["done", "done", "done"];
    default: return ["done", "bad", "todo"];
  }
}
