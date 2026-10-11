"use client";
// Deposit, hardcoded for the demo: shielded ZEC into finity, finity moves it into Ironwood, it lands ready to trade.
// The Zcash side is scripted and credits demo XZEC for this session; trading on Hyperliquid stays live.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { motion } from "motion/react";
import { brushRect } from "@/lib/sketch";
import { creditDemoZec } from "@/lib/central/demo-zec";
import { DoneMark, DrawOn, LogoMark, Star } from "@/components/sketch";
import { EASE, FlowHead, Icon, StepView, Tracker, type StepState } from "@/components/wallet/ui";

/** finity's shielded deposit address (demo). */
const DEPOSIT_ADDRESS = "u1finity7qz9h4kx2m8w5d3rjv6ytn0pl4sfe8ca2gk7xw3nd9mq5ur6ht0zv8lj2yp4cs7ea5wk3dn9fq6mx2vr8tg0hl5uj7zc3ys9ep4ka6wd2nq8fx5mt0rv3gl7hj9uc2zs6yk4ea8pw";
const FLOW = ["amount", "pay", "track"] as const;
type Step = (typeof FLOW)[number];
const TITLES: Record<Step, string> = { amount: "Deposit", pay: "Scan to pay", track: "On its way" };

/** The scripted journey, with how long each stage holds before the next (ms). */
const STAGES = [
  { title: "Payment received", sub: "Shielded ZEC reached finity. Sender and amount stay private.", ms: 2600 },
  { title: "Moving into Ironwood", sub: "finity deposits your ZEC into Ironwood.", ms: 4200 },
  { title: "Landing on Hyperliquid", sub: "XZEC is credited to your trading account.", ms: 2400 },
] as const;

/** Live ZEC price from Hyperliquid mainnet, for the dollar estimate. */
function useZecPrice() {
  const [px, setPx] = useState(0);
  useEffect(() => {
    fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "allMids" }) })
      .then((r) => r.json()).then((m) => setPx(Number(m.ZEC) || 0)).catch(() => {});
  }, []);
  return px;
}
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Zcash → Ironwood → Hyperliquid, with a star travelling along it. */
function Route({ at, progress }: { at: number; progress: number }) {
  // at: 0 = at Zcash, 1 = at Ironwood, 2 = at Hyperliquid
  const pos = Math.min(2, at + progress) / 2;
  return (
    <div className="route">
      <div className="route-track"><motion.i animate={{ width: `${pos * 100}%` }} transition={{ duration: 0.2, ease: "linear" }} /></div>
      <motion.span className="route-star" animate={{ left: `${100 / 6 + pos * 200 / 3}%` }} transition={{ duration: 0.2, ease: "linear" }}><Star /></motion.span>
      {[
        { name: "Zcash", sub: "shielded", node: <img src="/tokens/zec.svg" alt="" /> },
        { name: "Ironwood", sub: "finity", node: <span className="route-iron"><LogoMark detail={2} /></span> },
        { name: "Hyperliquid", sub: "trading", node: <span className="route-hl"><img src="/tokens/hl.svg" alt="" /></span> },
      ].map((n, i) => (
        <div key={n.name} className={`route-node${i <= at ? " on" : ""}`}>
          <span className="route-ic">{n.node}</span>
          <b>{n.name}</b><small>{n.sub}</small>
        </div>
      ))}
    </div>
  );
}

export default function Fund() {
  const [step, setStep] = useState<Step>("amount");
  const [dir, setDir] = useState(1);
  const go = (s: Step) => { setDir(FLOW.indexOf(s) >= FLOW.indexOf(step) ? 1 : -1); setStep(s); };
  const px = useZecPrice();

  const [amount, setAmount] = useState("0.5");
  const amt = Number(amount);
  const ok = Number.isFinite(amt) && amt >= 0.01;
  const uri = `zcash:${DEPOSIT_ADDRESS}?amount=${amount}&message=finity%20deposit`;

  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (step === "pay") QRCode.toDataURL(uri, { margin: 0, width: 400, errorCorrectionLevel: "H", color: { dark: "#0b1236", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [step, uri]);

  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(DEPOSIT_ADDRESS); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  // Walk the scripted stages once the user says they've paid.
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (step !== "track" || stage >= STAGES.length) return;
    const start = performance.now(), ms = STAGES[stage].ms;
    const id = setInterval(() => {
      const p = Math.min(1, (performance.now() - start) / ms);
      setProgress(p);
      if (p >= 1) { clearInterval(id); setStage((s) => s + 1); setProgress(0); }
    }, 60);
    return () => clearInterval(id);
  }, [step, stage]);
  const done = stage >= STAGES.length;

  // Credit the deposit to this session's wallet exactly once.
  const credited = useRef(false);
  useEffect(() => { if (done && !credited.current) { credited.current = true; creditDemoZec(amt); } }, [done, amt]);

  const states: StepState[] = STAGES.map((_, i) => (i < stage ? "done" : i === stage ? "active" : "todo"));
  const back = step === "pay" ? () => go("amount") : undefined;
  const start = () => { credited.current = false; setStage(0); setProgress(0); go("track"); };

  return (
    <div className="flow">
      <FlowHead title={TITLES[step]} step={FLOW.indexOf(step)} total={FLOW.length} onBack={back} />

      <StepView k={step} dir={dir}>
        {step === "amount" && (
          <div className="stack">
            <div className="dep-asset">
              <img src="/tokens/zec.svg" alt="" />
              <span><b>Zcash</b><small>From your shielded wallet</small></span>
              <span className="badge ink"><i />Shielded</span>
            </div>
            <div className="dep-amount">
              <div className="amount-big">
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount in ZEC" style={{ width: `${Math.max(2, amount.length + 0.5)}ch` }} />
                <span>ZEC</span>
              </div>
              <p className="dep-usd">{px && ok ? `≈ ${usd(amt * px)}` : " "}</p>
              <div className="chips">
                {["0.1", "0.5", "1", "5"].map((v) => (
                  <button key={v} type="button" className={`chip${amount === v ? " on" : ""}`} onClick={() => setAmount(v)}>{v}</button>
                ))}
              </div>
            </div>
            <Route at={0} progress={0} />
            <div className="facts">
              <div><span>You receive</span><b>{ok ? amount : "—"} XZEC</b></div>
              <div><span>Arrives in</span><b>~2 minutes</b></div>
            </div>
            <button type="button" className="btn btn-lg btn-block" disabled={!ok} onClick={() => go("pay")}>Continue</button>
          </div>
        )}

        {step === "pay" && (
          <div className="stack">
            <div className="qr-stage">
              <svg viewBox="0 0 260 260" className="qr-frame" aria-hidden><DrawOn d={brushRect(8, 8, 244, 244, 26)} width={5} duration={1.2} /></svg>
              {qr && (
                <motion.div className="qr-box" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, duration: 0.5, ease: EASE }}>
                  <img src={qr} alt="Zcash payment request" />
                  <span className="qr-logo"><img src="/tokens/zec.svg" alt="" /></span>
                </motion.div>
              )}
            </div>
            <div className="pay-sum">
              <b>{amount} ZEC</b>
              {px > 0 && <small>≈ {usd(amt * px)}</small>}
            </div>
            <div className="addr addr-stack">
              <span className="field-label">finity shielded address</span>
              <code>{DEPOSIT_ADDRESS.slice(0, 22)}…{DEPOSIT_ADDRESS.slice(-12)}</code>
              <button type="button" className="icon-btn" onClick={copy} aria-label="Copy address"><Icon name={copied ? "check" : "copy"} /></button>
            </div>
            <div className="btn-row">
              <a className="btn btn-ghost" href={uri}>Open wallet</a>
              <button type="button" className="btn grow" onClick={start}>I&apos;ve sent it</button>
            </div>
            <p className="waiting"><i />Waiting for your payment</p>
          </div>
        )}

        {step === "track" && (
          <div className="stack">
            {done ? (
              <div className="done">
                <DoneMark className="done-mark" />
                <h2>{amount} XZEC arrived</h2>
                <p>It&apos;s in your wallet{px ? ` (≈ ${usd(amt * px)})` : ""}, ready to swap and trade.</p>
                <div className="btn-row" style={{ width: "100%" }}>
                  <Link href="/wallet" className="btn btn-ghost">View wallet</Link>
                  <Link href="/trade" className="btn grow">Start trading →</Link>
                </div>
              </div>
            ) : (<>
              <Route at={stage} progress={progress} />
              <motion.div key={stage} className="status-head" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
                <h2>{STAGES[stage].title}</h2>
                <p>{STAGES[stage].sub}</p>
              </motion.div>
              <Tracker items={STAGES.map((s, i) => ({ s: states[i], title: s.title }))} />
              <div className="facts">
                <div><span>Amount</span><b>{amount} ZEC</b></div>
                <div><span>Value</span><b>{px ? usd(amt * px) : "—"}</b></div>
              </div>
            </>)}
          </div>
        )}
      </StepView>
    </div>
  );
}
