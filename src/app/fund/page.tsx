"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { Network } from "@/lib/bridge/guardians";
import { UnitBridgeAdapter, checkFundingAmount, crossCheckMapping, type BridgeAdapter, type VerifiedDeposit, type ZcashFees } from "@/lib/bridge/unit";
import { deriveFunding, mergeOperations, recordPollError, opPhase, type FundingRecord } from "@/lib/bridge/funding";
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

  return (
    <main>
      <div className="note warn">TESTNET PROTOTYPE: no real funds. Mainnet funding is disabled.</div>
      {isReplay && <div className="note bad"><b>REPLAY FIXTURE LANE ({lane})</b>: operations and balances on this screen are simulated. Nothing here is settlement evidence.</div>}
      <h1>Fund your trading account</h1>

      <section className="panel">
        <label>Lane{" "}
          <select value={lane} onChange={(e) => setLane(e.target.value as Lane)}>
            <option value="unit-live">Unit testnet (live API)</option>
            {REPLAY_SCENARIOS.map((s) => <option key={s} value={s}>Replay: {s}</option>)}
          </select>
        </label>
        <p><label>Hyperliquid testnet trading account<br />
          <input className="mono" style={{ width: "100%" }} value={hl} onChange={(e) => setHl(e.target.value.trim())} /></label></p>
        <label><input type="checkbox" checked={recoveryOk} onChange={(e) => setRecoveryOk(e.target.checked)} />{" "}
          I have confirmed I can control this account with the recovery client (<code>recovery/recover.ts</code>) without this site.</label>
        <p><button disabled={!validHl} onClick={generate}>Get verified deposit address</button></p>
      </section>

      {err && <div className="note bad">Error: {err}</div>}

      {dep && fees && (
        <section className="panel">
          <h2>Deposit address</h2>
          <p className="mono" style={{ wordBreak: "break-all", color: "var(--zec)" }}>{dep.payAddress}</p>
          <ul>
            <li>Type: {dep.payKind === "tex" ? "TEX (your wallet will unshield to a one-time transparent address first, per ZIP 320)" : "transparent P2PKH"}; network {dep.network}</li>
            <li>Guardians: {dep.verification.verifiedCount} of 3 signatures valid against pinned {dep.network} keys (2 required)</li>
            <li>Mapping cross-check: {mapNote}</li>
            <li>Inbound fee now: {zec(fees.depositFeeZat)}, ETA {fees.depositEta} (100 Zcash confirmations). Fetched {fees.fetchedAt}{fees.source === "replay" && " (replayed snapshot)"}</li>
            <li>Unit minimum: 0.07 ZEC. Deposits below it get stuck and are only reprocessed if Unit lowers the minimum.</li>
            <li>Received ZEC arrives as a Hyperliquid spot token; converting it to USDC margin is a separate step you confirm later.</li>
          </ul>
          {view?.mayShowPaymentRequest ? (<>
            <label>Amount to send (ZEC) <input value={amount} onChange={(e) => { setAmount(e.target.value.trim()); setConsent(false); }} /></label>
            {check && !check.ok && <div className="note bad">{check.reason}</div>}
            {check?.ok && <p>Estimated after inbound fee: {zec(check.estNetZat)}, before conversion spread and trading fees.</p>}
            <label><input type="checkbox" checked={consent} disabled={!check?.ok} onChange={(e) => setConsent(e.target.checked)} />{" "}
              I understand the ~2 hour wait, the fees, that the bridge leg is publicly visible, and that Unit (not this app) holds the backing ZEC.</label>
            {!recoveryOk && <p>Confirm recovery above before a payment request is shown.</p>}
            {qr && (<div>
              <img src={qr} alt="ZIP-321 payment request" width={240} height={240} />
              <p><button onClick={() => navigator.clipboard?.writeText(dep.payAddress)}>Copy address</button>{" "}
                Send exactly {amount} ZEC from a testnet-capable wallet. Send once; this page will follow it.</p>
            </div>)}
          </>) : <p><b>No new payment request is shown</b> because a deposit is already recorded or Unit cannot be reached. Do not send again.</p>}
        </section>
      )}

      {view && rec && (
        <section className="panel">
          <h2>Status: {view.state.replace(/_/g, " ")}</h2>
          <p>{view.explanation}</p>
          {view.stale && <div className="note warn">Last poll failed ({rec.lastPollError?.message}) at {rec.lastPollError?.at}. Showing last known state; nothing has been lost.</div>}
          <p>Unit ZEC balance on Hyperliquid: {balance ? `${balance.total} (${balance.label})` : "not read yet"}</p>
          {view.operations.map((o) => (
            <details key={o.operationId + o.sourceTxHash} style={{ fontSize: 13 }}>
              <summary>{o.sourceTxHash ?? o.operationId}: {o.state} ({opPhase(o)}){o.sourceTxConfirmations !== undefined && `, ${o.sourceTxConfirmations}/100 confirmations`}</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(o, null, 2)}</pre>
            </details>
          ))}
          <p style={{ fontSize: 13 }}>Evidence: {rec.source === "replay" ? "replay fixture, not a bridge transfer" : "live Unit testnet API"}. Last good poll {rec.lastPollOk ?? "never"}.</p>
        </section>
      )}
    </main>
  );
}
