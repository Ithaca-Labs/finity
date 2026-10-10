"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { motion } from "motion/react";
import type { Network } from "@/lib/bridge/guardians";
import { UnitBridgeAdapter, checkFundingAmount, crossCheckMapping, type BridgeAdapter, type VerifiedDeposit, type ZcashFees } from "@/lib/bridge/unit";
import { deriveFunding, mergeOperations, recordPollError, opPhase, type FundingRecord, type FundingState } from "@/lib/bridge/funding";
import { ReplayBridgeAdapter, REPLAY_SCENARIOS, type ReplayScenario } from "@/lib/replay/unit-replay";
import { buildZip321, formatZecAmount, zecToZatoshis } from "@/lib/zcash/address";
import { loadFunding, saveFunding } from "@/lib/store/funding-store";
import { unitZecBalance } from "@/lib/hl/xzec";
import { brushRect } from "@/lib/sketch";
import { DoneMark, DrawOn } from "@/components/sketch";
import { short, useAccount } from "@/components/wallet/account";
import { BackupCard, CreateAccount } from "@/components/wallet/shell";
import { Callout, EASE, FlowHead, Icon, StepView, Tracker, type StepState } from "@/components/wallet/ui";

const NETWORK: Network = "testnet"; // mainnet funding is disabled in this prototype
type Lane = "unit-live" | ReplayScenario;
const kv = () => { try { return window.localStorage; } catch { return undefined; } };
const zec = (z: bigint) => formatZecAmount(z) + " ZEC";

const FLOW = ["to", "amount", "pay", "track"] as const;
type Step = (typeof FLOW)[number];
const TITLES: Record<Step, string> = { to: "Deposit ZEC", amount: "How much?", pay: "Scan to pay", track: "Deposit status" };

export default function Fund() {
  const { user, valid, backedUp } = useAccount();
  const [lane, setLane] = useState<Lane>("unit-live");
  const hl = valid ? user : "";
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

  // ---- flow ----
  const [step, setStep] = useState<Step>("to");
  const [dir, setDir] = useState(1);
  const go = (s: Step) => { setDir(FLOW.indexOf(s) >= FLOW.indexOf(step) ? 1 : -1); setStep(s); };
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const autoTracked = useRef(false);
  useEffect(() => { autoTracked.current = false; setStep("to"); }, [lane, hl]);
  // Something is already in flight (or the bridge is unreachable): the only safe screen is status.
  useEffect(() => {
    if (view && (!view.mayShowPaymentRequest || view.operations.length > 0) && !autoTracked.current) { autoTracked.current = true; setDir(1); setStep("track"); }
  }, [view]);

  const getAddress = async () => { setBusy(true); await generate(); setBusy(false); };
  useEffect(() => { if (dep && step === "to" && view?.mayShowPaymentRequest) { setDir(1); setStep("amount"); } }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => { navigator.clipboard?.writeText(dep!.payAddress); setCopied(true); setTimeout(() => setCopied(false), 1600); };
  const uri = dep && amountZat !== null && canShowQr ? buildZip321(dep.payAddress, NETWORK, amountZat) : null;
  const confs = view ? Math.max(0, ...view.operations.map((o) => o.sourceTxConfirmations ?? 0)) : 0;
  const steps = view ? fundSteps(view.state, view.operations.length > 0 && view.operations.every((o) => opPhase(o) === "done")) : null;
  const tone = view && ["below_minimum_stuck", "manual_recovery"].includes(view.state) ? "bad" : view?.state === "recoverable_error" ? "warn" : null;
  const back = step === "amount" ? () => go("to") : step === "pay" ? () => go("amount") : step === "track" && view?.mayShowPaymentRequest ? () => go(dep ? "pay" : "to") : undefined;

  return (
    <div className="flow">
      <FlowHead title={TITLES[step]} step={FLOW.indexOf(step)} total={FLOW.length} onBack={back} />
      {isReplay && <Callout tone="bad" title={`Simulation mode (${lane})`}>Everything here is simulated from a recorded fixture. Nothing is a real transfer.</Callout>}
      {err && <Callout tone="bad" title="Something went wrong">{err}</Callout>}

      <StepView k={step} dir={dir}>
        {step === "to" && (
          <div className="stack">
            <div className="hero-ic"><Icon name="fund" /></div>
            <p className="flow-lede">Send ZEC from your shielded Zcash wallet. It lands in your trading account in about two hours.</p>

            {!valid ? <CreateAccount /> : (<>
            <div className="to-card">
              <span className="field-label">Lands in</span>
              <div className="to-row">
                <span className="to-ic"><Icon name="trade" /></span>
                <span><b>Your finity trading account</b><small className="mono">{short(hl)}</small></span>
              </div>
            </div>
            <BackupCard />

            <label className="check">
              <input type="checkbox" checked={recoveryOk} onChange={(e) => setRecoveryOk(e.target.checked)} />
              <span>I can reach this account without finity.<small>I&apos;ve checked the recovery client (<code>recovery/recover.ts</code>) can read and control it if this site disappears.</small></span>
            </label>

            <button type="button" className="btn btn-lg btn-block" disabled={!validHl || !backedUp || busy} onClick={getAddress}>
              {busy ? <span className="spinner" /> : null}{busy ? "Checking with the bridge…" : "Get my deposit address"}
            </button>
            </>)}
            {rec && <button type="button" className="text-link" onClick={() => go("track")}>View current deposit status</button>}

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
          </div>
        )}

        {step === "amount" && dep && fees && (
          <div className="stack">
            <div className="amount-big">
              <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.trim()); setConsent(false); }} aria-label="Amount in ZEC" style={{ width: `${Math.max(2, amount.length + 0.5)}ch` }} />
              <span>ZEC</span>
            </div>
            <div className="chips">
              {["0.1", "0.25", "0.5", "1"].map((v) => (
                <button key={v} type="button" className={`chip${amount === v ? " on" : ""}`} onClick={() => { setAmount(v); setConsent(false); }}>{v}</button>
              ))}
            </div>
            <motion.p className="amount-note" key={String(check?.ok)} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {check?.ok ? <>You&apos;ll receive about <b>{zec(check.estNetZat)}</b></> : check ? <span style={{ color: "var(--bad)" }}>{check.reason}</span> : null}
            </motion.p>
            <div className="facts">
              <div><span>Minimum</span><b>0.07 ZEC</b></div>
              <div><span>Bridge fee</span><b>{zec(fees.depositFeeZat)}</b></div>
              <div><span>Arrives in</span><b>{fees.depositEta}</b></div>
            </div>
            <label className="check">
              <input type="checkbox" checked={consent} disabled={!check?.ok} onChange={(e) => setConsent(e.target.checked)} />
              <span>I understand how this works.<small>It takes about 2 hours, fees apply, the bridge step is publicly visible, and the Unit bridge (not finity) holds the backing ZEC.</small></span>
            </label>
            {!recoveryOk && <Callout tone="warn">Go back and confirm you can reach this account without finity first.</Callout>}
            <button type="button" className="btn btn-lg btn-block" disabled={!canShowQr} onClick={() => go("pay")}>Continue</button>
            <span className="badge good center"><i />{dep.verification.verifiedCount}/3 guardians verified</span>
          </div>
        )}

        {step === "pay" && dep && fees && (
          <div className="stack">
            <div className="qr-stage">
              <svg viewBox="0 0 260 260" className="qr-frame" aria-hidden><DrawOn d={brushRect(8, 8, 244, 244, 26)} width={5} duration={1.2} /></svg>
              {qr ? <motion.img src={qr} alt="ZIP-321 payment request" width={200} height={200} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.35, duration: 0.5, ease: EASE }} />
                : <div className="qr-wait">Confirm the amount to see your code.</div>}
            </div>
            <p className="pay-amt">Send exactly <b>{amount} ZEC</b>, once.</p>
            <div className="addr"><code>{dep.payAddress}</code>
              <button type="button" className="icon-btn" onClick={copy} aria-label="Copy address"><Icon name={copied ? "check" : "copy"} /></button>
            </div>
            <div className="btn-row">
              {uri && <a className="btn btn-ghost" href={uri}>Open in wallet</a>}
              <button type="button" className="btn grow" onClick={() => go("track")}>I&apos;ve sent it</button>
            </div>
            <span className="badge good center"><i />{dep.verification.verifiedCount}/3 guardians verified</span>
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
          </div>
        )}

        {step === "track" && (
          <div className="stack">
            {!view || !rec || !steps ? (
              <Callout title="No deposit yet">Get a deposit address first.</Callout>
            ) : view.state === "unit_token_received" ? (
              <div className="done">
                <DoneMark className="done-mark" />
                <h2>Your ZEC has arrived</h2>
                <p>{balance ? `${balance.total} ZEC` : ""} is in your trading account, ready to swap and trade.</p>
                <Link href="/trade?tab=swap" className="btn btn-lg btn-block">Swap to USDC →</Link>
              </div>
            ) : (<>
              <div className="status-head">
                <h2>{FUND_TITLE[view.state]}</h2>
                <p>{view.explanation}</p>
              </div>
              {tone && <Callout tone={tone} title={tone === "bad" ? "This deposit needs attention" : "Reconnecting"}>Keep this page&apos;s record. Nothing is lost; see the runbook if it doesn&apos;t clear.</Callout>}
              {view.stale && <Callout tone="warn" title="Showing the last known status">The latest check failed ({rec.lastPollError?.message}). Nothing has been lost.</Callout>}
              {!view.mayShowPaymentRequest && view.operations.length === 0 && <Callout tone="warn" title="Don't send again">The bridge can&apos;t be reached right now. If you already sent, it will appear here.</Callout>}
              <Tracker items={[
                { s: steps[0], title: "Payment sent", sub: steps[0] === "done" ? "We've spotted your Zcash transaction" : "Waiting to spot your Zcash transaction" },
                { s: steps[1], title: "Confirming on Zcash", sub: <>{confs ? `${Math.min(confs, 100)} of 100 confirmations` : "100 confirmations, about 2 hours"}
                  {steps[1] === "active" && confs > 0 && <span className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(confs, 100)}%` }} transition={{ duration: 1, ease: EASE }} /></span>}</> },
                { s: steps[2], title: "Ready to trade", sub: "ZEC lands in your Hyperliquid account" },
              ]} />
              <div className="facts">
                <div><span>ZEC in your account</span><b>{balance ? balance.total : "—"}</b></div>
                <div><span>Source</span><b>{rec.source === "replay" ? "Simulation" : "Live testnet"}</b></div>
              </div>
            </>)}
            {rec && view && (
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
            )}
          </div>
        )}
      </StepView>
    </div>
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

function fundSteps(s: FundingState, bridgeDone: boolean): [StepState, StepState, StepState] {
  switch (s) {
    case "awaiting_deposit": case "recoverable_error": return ["active", "todo", "todo"];
    case "deposit_seen": return ["done", "active", "todo"];
    case "bridge_pending": return bridgeDone ? ["done", "done", "active"] : ["done", "active", "todo"];
    case "unit_token_received": return ["done", "done", "done"];
    default: return ["done", "bad", "todo"];
  }
}
