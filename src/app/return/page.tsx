"use client";
import { useEffect, useMemo, useState } from "react";
import type { Network } from "@/lib/bridge/guardians";
import { UnitBridgeAdapter, type ZcashFees } from "@/lib/bridge/unit";
import { balanceToZat, fmtZec, generateWithdrawal, planReturn, validateReturnDestination, type VerifiedWithdrawal } from "@/lib/bridge/withdraw";
import { deriveReturn } from "@/lib/bridge/return-state";
import { RETURN_SCENARIOS, type ReturnScenario } from "@/lib/replay/return-replay";
import { unitZecBalance } from "@/lib/hl/xzec";

const NETWORK: Network = "testnet"; // mainnet return is disabled in this prototype
type Lane = "live" | ReturnScenario;
type FailedPlan = Extract<ReturnType<typeof planReturn>, { ok: false }>;
const box: React.CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12, margin: "12px 0" };
const banner = (bg: string): React.CSSProperties => ({ background: bg, padding: 8, borderRadius: 6, margin: "8px 0" });
const statusColor: Record<string, string> = { tested: "#bbf7d0", implemented_untested: "#fde68a", documented_only: "#e5e7eb", untested: "#fde68a", attempt_failed: "#fecaca" };
const kv = () => { try { return window.localStorage; } catch { return undefined; } };

export default function Return() {
  const [lane, setLane] = useState<Lane>("live");
  const [hl, setHl] = useState("0x1f20B96A9fde5218ED05A212B2d23093100785c0");
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState<ZcashFees | null>(null);
  const [live, setLive] = useState<{ token: string; total: number } | null>(null);
  const [wd, setWd] = useState<VerifiedWithdrawal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const [spentTx, setSpentTx] = useState("");

  const isReplay = lane !== "live";
  const scenario = isReplay ? RETURN_SCENARIOS[lane as ReturnScenario] : null;

  useEffect(() => {
    try { setMarked(kv()?.getItem(`shield-mark:${hl.toLowerCase()}`) === "1"); } catch { /* storage unavailable */ }
  }, [hl]);

  useEffect(() => {
    if (isReplay) return;
    new UnitBridgeAdapter(NETWORK).fees().then(setFees).catch((e) => setErr(`Fee read failed: ${e.message}`));
    if (/^0x[0-9a-fA-F]{40}$/.test(hl)) unitZecBalance(NETWORK, hl).then(setLive).catch((e) => setErr(`Balance read failed (last value kept): ${e.message}`));
  }, [hl, isReplay]);

  // Replay uses a fixed fee snapshot so the below-minimum case renders without a network call.
  const replayFees: ZcashFees = { source: "replay", depositFeeZat: 581428n, depositEta: "126m", withdrawalFeeZat: 15000n, withdrawalEta: "5m", fetchedAt: "fixture" };
  const feeSnap = isReplay ? replayFees : fees;

  const balanceZat = scenario ? scenario.evidence.tokenBalanceZat : live ? balanceToZat(String(Math.floor(live.total * 1e8) / 1e8)) : null;
  const destCheck = dest ? validateReturnDestination(NETWORK, dest) : null;
  const requested = useMemo(() => { try { return amount ? balanceToZat(amount) : null; } catch { return null; } }, [amount]);
  const plan = balanceZat !== null && requested !== null && feeSnap ? planReturn({ balanceZat, requestedZat: requested, fees: feeSnap }) : null;
  // With no amount typed, show whether the whole balance could be returned at all.
  const wholeBalance = balanceZat !== null && balanceZat > 0n && feeSnap ? planReturn({ balanceZat, requestedZat: balanceZat, fees: feeSnap }) : null;
  const failed: FailedPlan | null = plan && !plan.ok ? plan : wholeBalance && !wholeBalance.ok ? wholeBalance : null;

  const view = deriveReturn(scenario
    ? { ...scenario.evidence, userMarkedShielded: marked || scenario.evidence.userMarkedShielded, transparentOutputSpentTxid: spentTx || scenario.evidence.transparentOutputSpentTxid }
    : { tokenBalanceZat: balanceZat, userMarkedShielded: marked, transparentOutputSpentTxid: spentTx || undefined });

  async function verify() {
    setErr(null); setWd(null);
    try { setWd(await generateWithdrawal(NETWORK, dest, hl)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <div style={banner("#fde68a")}>TESTNET PROTOTYPE: no real funds. Mainnet return is disabled.</div>
      {isReplay && <div style={banner("#fbcfe8")}><b>REPLAY (fixture):</b> {scenario!.title}. This is not a Unit operation and no funds moved.</div>}
      <h1>Return to Zcash</h1>
      <label>Lane: <select value={lane} onChange={(e) => { setLane(e.target.value as Lane); setErr(null); setWd(null); setAmount(""); }}>
        <option value="live">Live (testnet)</option>
        {Object.entries(RETURN_SCENARIOS).map(([k, v]) => <option key={k} value={k}>Replay: {v.title}</option>)}
      </select></label>
      {err && <div style={banner("#fecaca")}>{err}</div>}

      {!isReplay && <div style={box}>
        <label>Trading account <input style={{ width: "100%", fontFamily: "monospace" }} value={hl} onChange={(e) => setHl(e.target.value.trim())} /></label>
        <p>Unit ZEC token balance: {live ? `${live.total} ${live.token}` : "not read yet"}. Return minimum: 0.07 ZEC. Withdrawal fee: {fees ? `${fmtZec(fees.withdrawalFeeZat)} ZEC` : "…"} (live, moves).</p>
        <div style={banner("#fecaca")}><b>Testnet limitation (observed 8 Oct 2026):</b> Unit&apos;s testnet rejects every Zcash destination for withdrawals (&quot;address failed verification&quot;), and the XZEC order book is empty. A real testnet return cannot be demonstrated. Mainnet generation does verify (3 of 3 guardians) but no mainnet transfer was made.</div>
      </div>}

      <div style={box}>
        <h3>1. Destination</h3>
        <input placeholder="transparent t… address from your Zcash wallet" style={{ width: "100%", fontFamily: "monospace" }} value={dest} onChange={(e) => { setDest(e.target.value.trim()); setWd(null); }} />
        {destCheck && !destCheck.ok && <p style={{ color: "#b91c1c" }}>{destCheck.reason}</p>}
        {destCheck?.ok && !isReplay && <button onClick={verify}>Generate and verify Unit return address</button>}
        {wd && <p>Verified ({wd.verification.verifiedCount}/3 guardians). Send ONLY the Unit ZEC token to <code>{wd.protocolAddress}</code>.</p>}
      </div>

      <div style={box}>
        <h3>2. Amount and residual</h3>
        <input placeholder="ZEC to return" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {balanceZat !== null && balanceZat > 0n && <button onClick={() => setAmount(fmtZec(balanceZat))}>Use full balance</button>}
        {plan?.ok && <p>Send {fmtZec(plan.sendZat)}, fee {fmtZec(plan.feeZat)}, estimated net {fmtZec(plan.netZat)} ZEC. Remaining in account: {fmtZec(plan.residualZat)} ZEC.{plan.warnings.map((w) => <span key={w}><br /><b>Warning: {w}</b></span>)}</p>}
        {failed && <div>
          <p style={{ color: "#b91c1c" }}>{failed.reason}</p>
          {failed.recovery.length > 0 && <>
            <b>What you can do with the {fmtZec(failed.residualZat)} ZEC:</b>
            {failed.recovery.map((o) => (
              <div key={o.id} style={{ ...box, background: statusColor[o.status] }}>
                <b>{o.title}</b> <i>[{o.status.replace(/_/g, " ")}]</i><br />{o.description}
              </div>
            ))}
          </>}
        </div>}
        <button disabled title="Disabled: no verified withdrawal route exists on testnet, and mainnet is off in this prototype">Send to Unit</button>
      </div>

      <div style={box}>
        <h3>3. Status</h3>
        <p><b>{view.state.replace(/_/g, " ")}</b>: {view.explanation}</p>
        {view.destinationTxHash && <p>Zcash transaction: <code>{view.destinationTxHash}</code></p>}
        <p>Shielding evidence: <b>{view.shielding.replace(/_/g, " ")}</b></p>
        {(view.state === "delivered_transparent" || view.shielding !== "not_started") && <>
          <label><input type="checkbox" checked={marked} onChange={(e) => { setMarked(e.target.checked); try { kv()?.setItem(`shield-mark:${hl.toLowerCase()}`, e.target.checked ? "1" : "0"); } catch { /* ignore */ } }} /> I shielded it in my wallet (this alone proves nothing)</label><br />
          <label>Txid that spent the transparent output (optional) <input value={spentTx} onChange={(e) => setSpentTx(e.target.value.trim())} /></label>
          <p style={{ fontSize: 13 }}>&quot;Wallet-confirmed shielded&quot; needs evidence from the wallet itself. No wallet integration exists in this prototype, so it can only appear in a replay.</p>
        </>}
      </div>
    </main>
  );
}
