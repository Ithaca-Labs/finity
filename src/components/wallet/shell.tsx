"use client";
// The wallet: a compact card (Phantom-style) beside a living stage that shows where your ZEC is on the loop.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AnimatePresence, motion, useAnimationFrame, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform,
} from "motion/react";
import { DrawOn, LogoMark, SketchPath, Star } from "@/components/sketch";
import { ThemeToggle } from "@/components/theme";
import { brushRing, lemniscate, lemniscatePoint, sparkle } from "@/lib/sketch";
import { AccountProvider, short, useAccount } from "./account";
import { EASE, Icon, Sheet } from "./ui";

const TABS = [
  { href: "/wallet", label: "Home", icon: "home" },
  { href: "/fund", label: "Fund", icon: "fund" },
  { href: "/trade", label: "Trade", icon: "trade" },
  { href: "/return", label: "Return", icon: "return" },
] as const;

/** Where the star rides on the loop for each screen: t runs 0→0.5 around Zcash, 0.5→1 around Hyperliquid. */
const ROUTES: Record<string, { from: number; to: number; ms: number; kicker: string; title: string; body: string }> = {
  "/wallet": { from: 0, to: 1, ms: 14000, kicker: "Your round trip", title: "Out and back.", body: "Shielded ZEC crosses to a fresh Hyperliquid account, trades in the open, and comes home shielded." },
  "/fund": { from: 0.25, to: 0.58, ms: 5200, kicker: "Step 1 · Fund · ~2 hours", title: "Cross the bridge.", body: "One payment from your shielded wallet. 100 Zcash confirmations later, it lands in your trading account." },
  "/trade": { from: 0.58, to: 0.94, ms: 7000, kicker: "Step 2 · Trade · seconds", title: "Trade in the open.", body: "Swap and trade on Hyperliquid. Every order is reviewed before you sign it, and closing is never blocked." },
  "/return": { from: 0.94, to: 1.25, ms: 5200, kicker: "Step 3 · Return · ~2 hours", title: "Come home shielded.", body: "Send ZEC to a fresh address from your own wallet, then shield it with one tap." },
};

export function WalletShell({ children }: { children: ReactNode }) {
  return (
    <AccountProvider>
      <div className="w-app">
        <Stage />
        <Card>{children}</Card>
      </div>
    </AccountProvider>
  );
}

function routeKey(path: string) {
  return TABS.find((t) => path.startsWith(t.href))?.href ?? "/wallet";
}

/* ---------------- Stage ---------------- */

const LOOP_CX = 150, LOOP_CY = 86, LOOP_A = 110;
const LOOP = lemniscate({ cx: LOOP_CX, cy: LOOP_CY, a: LOOP_A });
const LENS_RING = brushRing(100, 100, 84);
const PAPER_INK = { "--ink": "var(--paper)", "--ink-2": "var(--paper)", "--ink-3": "var(--paper)" } as CSSProperties;

function Stage() {
  const key = routeKey(usePathname());
  const r = ROUTES[key];
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  // Lens over the banner, following the mouse inside the stage (Finity's hero, in miniature).
  const w = useMotionValue(0), h = useMotionValue(0), tx = useMotionValue(0), ty = useMotionValue(0);
  const lx = useSpring(tx, { stiffness: 120, damping: 20, mass: 0.6 });
  const ly = useSpring(ty, { stiffness: 120, damping: 20, mass: 0.6 });
  const last = useRef(-Infinity);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { w.set(e.contentRect.width); h.set(e.contentRect.height); });
    ro.observe(el);
    const onMove = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      if (e.clientX < b.left || e.clientX > b.right) return;
      tx.set(e.clientX - b.left); ty.set(e.clientY - b.top); last.current = performance.now();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { ro.disconnect(); window.removeEventListener("pointermove", onMove); };
  }, [w, h, tx, ty]);

  // The star rides the loop for this screen; the lens drifts along an ∞ when the mouse is away.
  const t = useMotionValue(r.from);
  const started = useRef(performance.now());
  useEffect(() => { started.current = performance.now(); }, [key]);
  useAnimationFrame((time) => {
    if (reduced) { t.set((r.from + r.to) / 2); return; }
    const u = ((performance.now() - started.current) % (r.ms + 1400)) / r.ms;
    const e = Math.min(1, u);
    t.set(r.from + (r.to - r.from) * (e < 0.5 ? 4 * e ** 3 : 1 - (-2 * e + 2) ** 3 / 2));
    if (performance.now() - last.current < 2500) return;
    const s = Math.PI / 2 + (time / 12000) * Math.PI * 2, k = 1 + Math.sin(s) ** 2, a = Math.min(w.get() * 0.3, 260);
    tx.set(w.get() / 2 + (a * Math.cos(s)) / k);
    ty.set(h.get() * 0.38 + (a * 0.8 * Math.sin(s) * Math.cos(s)) / k);
  });
  const sx = useTransform(t, (v) => lemniscatePoint(LOOP_CX, LOOP_CY, LOOP_A, ((v % 1) + 1) % 1)[0]);
  const sy = useTransform(t, (v) => lemniscatePoint(LOOP_CX, LOOP_CY, LOOP_A, ((v % 1) + 1) % 1)[1]);
  const spin = useTransform(t, (v) => v * 360);
  const lensR = useTransform([w, h], ([W, H]: number[]) => Math.max(70, Math.min(W, H) * 0.2));
  const clip = useMotionTemplate`circle(${lensR}px at ${lx}px ${ly}px)`;
  const ringX = useTransform(lx, (x) => x - 100);
  const ringY = useTransform(ly, (y) => y - 100);
  const ringScale = useTransform(lensR, (v) => v / 84);
  const zecOn = key === "/fund" || key === "/return" || key === "/wallet";
  const hlOn = key === "/trade" || key === "/fund" || key === "/wallet";

  return (
    <aside className="w-stage" ref={ref} aria-hidden>
      <div className="w-stage-art">
        <img src="/brand/finity-dark-banner.webp" alt="" className="only-light" />
        <img src="/brand/finity-banner.webp" alt="" className="only-dark" />
      </div>
      <motion.div className="w-stage-art" style={{ clipPath: clip }}>
        <img src="/brand/finity-banner.webp" alt="" className="only-light" />
        <img src="/brand/finity-dark-banner.webp" alt="" className="only-dark" />
      </motion.div>
      <motion.div className="w-lens-ring" style={{ x: ringX, y: ringY, scale: ringScale, ...PAPER_INK }}>
        <svg viewBox="0 0 200 200"><SketchPath d={LENS_RING} width={5} passes={3} /></svg>
      </motion.div>

      <Link href="/" className="w-stage-brand"><span className="w-stage-mark"><LogoMark detail={2} /></span>finity</Link>

      <motion.div className="w-map" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}>
        <svg viewBox="0 0 300 172" className="w-map-svg">
          <DrawOn d={LOOP} width={5} duration={1.6} />
          <text x={LOOP_CX - LOOP_A * 0.6} y={LOOP_CY + 76} textAnchor="middle" className={`w-map-label${zecOn ? " on" : ""}`}>Zcash · shielded</text>
          <text x={LOOP_CX + LOOP_A * 0.6} y={LOOP_CY + 76} textAnchor="middle" className={`w-map-label${hlOn ? " on" : ""}`}>Hyperliquid · public</text>
          <line x1={LOOP_CX} y1={LOOP_CY - 62} x2={LOOP_CX} y2={LOOP_CY - 12} stroke="var(--ink)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" /><text x={LOOP_CX} y={LOOP_CY - 68} textAnchor="middle" className="w-map-label on">bridge</text>
          <motion.g style={{ x: sx, y: sy, rotate: spin }}>
            <circle r="17" fill="var(--ink)" opacity="0.14" />
            <path d={sparkle(0, 0, 13)} fill="var(--ink)" filter="url(#brush)" />
            <path d={sparkle(-1.2, -1.2, 5)} fill="var(--ink-3)" opacity="0.85" />
          </motion.g>
        </svg>
        <AnimatePresence mode="wait">
          <motion.div key={key} className="w-map-copy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4, ease: EASE }}>
            <p className="eyebrow"><Star />{r.kicker}</p>
            <h2>{r.title}</h2>
            <p>{r.body}</p>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </aside>
  );
}

/* ---------------- Card ---------------- */

function Avatar({ address }: { address: string }) {
  // A tiny brush loop tinted by the address, so each account looks like its own.
  const hue = parseInt(address.slice(2, 6) || "0", 16) % 360;
  return (
    <span className="avatar" style={{ "--hue": hue } as CSSProperties}>
      <svg viewBox="0 0 200 200"><path d={lemniscate({ cx: 100, cy: 100, a: 70 })} fill="none" stroke="var(--paper)" strokeWidth="18" strokeLinecap="round" /></svg>
    </span>
  );
}

function Card({ children }: { children: ReactNode }) {
  const path = usePathname();
  const key = routeKey(path);
  const { user, valid, backedUp, acct, setSheet } = useAccount();
  return (
    <div className="w-card">
      <header className="w-top">
        <button type="button" className="acct" onClick={() => setSheet(true)} aria-label="Account">
          <Avatar address={user} />
          <span className="acct-text">
            <b>{!acct.loaded ? "…" : valid ? "finity account" : "No account yet"}</b>
            <small><i className={valid && backedUp ? "dot good" : "dot"} />{valid ? short(user) : "Tap to create"}</small>
          </span>
          <svg viewBox="0 0 24 24" width="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 10l5 5 5-5" /></svg>
        </button>
        <div className="w-top-right">
          <span className="net-pill"><i />Testnet</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="w-body">
        <motion.div key={key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
          {children}
        </motion.div>
      </main>

      <nav className="w-tabs" aria-label="Wallet">
        {TABS.map((t) => {
          const on = key === t.href;
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className="w-tab">
              {on && <motion.span layoutId="tab-pill" className="w-tab-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="w-tab-in"><Icon name={t.icon} />{t.label}</span>
            </Link>
          );
        })}
      </nav>

      <AccountSheet />
    </div>
  );
}

function AccountSheet() {
  const { acct, valid, user, backedUp, sheet, setSheet } = useAccount();
  const [copied, setCopied] = useState(false);
  return (
    <Sheet open={sheet} onClose={() => setSheet(false)} title={valid ? "Your finity account" : "Create your account"}>
      {valid ? (
        <div className="stack-sm">
          <div className="addr"><code>{user}</code>
            <button type="button" className="icon-btn" aria-label="Copy address" onClick={() => { navigator.clipboard?.writeText(user); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
              <Icon name={copied ? "check" : "copy"} />
            </button>
          </div>
          <BackupCard />
          <p className="small muted">Two keys live in this browser: the account key owns your funds and signs transfers; a trading key can place and cancel orders but can never withdraw. finity never sees either.</p>
          {backedUp && <button type="button" className="text-link" onClick={acct.downloadBackup}>Download backup again</button>}
        </div>
      ) : <CreateAccount />}
    </Sheet>
  );
}

/** First run: create a fresh account in this browser, or restore one from a backup file. */
export function CreateAccount() {
  const { acct } = useAccount();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="stack-sm">
      <p className="small muted">finity creates a fresh Hyperliquid account for you right here. Its keys never leave your device, and finity can&apos;t move your funds.</p>
      <button type="button" className="btn btn-lg btn-block" onClick={acct.create}>Create my account</button>
      <label className="btn btn-ghost btn-block file-btn">
        Restore from a backup
        <input type="file" accept="application/json" onChange={async (e) => {
          setErr(null);
          const f = e.target.files?.[0];
          if (f) try { acct.restore(await f.text()); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
        }} />
      </label>
      {err && <p className="small" style={{ color: "var(--bad)" }}>{err}</p>}
    </div>
  );
}

/** The backup prompt: required before depositing, because the account lives only in this browser. */
export function BackupCard() {
  const { acct, backedUp } = useAccount();
  if (backedUp) return <p className="small muted"><Icon name="check" /> Backed up {new Date(acct.account!.backedUpAt!).toLocaleString()}.</p>;
  return (
    <div className="callout warn">
      <span className="callout-mark">!</span>
      <div>
        <b>Back up this account before depositing</b>
        <span>It lives only in this browser. Clearing site data without a backup loses access to the funds.</span>
        <div className="btn-row"><button type="button" className="btn btn-sm" onClick={acct.downloadBackup}>Download backup</button></div>
      </div>
    </div>
  );
}