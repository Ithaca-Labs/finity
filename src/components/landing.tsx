"use client";
// Landing scenes, cut from Finity's scroll language: a lens over the banner, a travelling star,
// the infinity loop as the round trip, eyes for what is public, and a portal into the wallet.
import Link from "next/link";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import Lenis from "lenis";
import {
  motion, useAnimationFrame, useInView, useMotionTemplate, useMotionValue, useMotionValueEvent, useReducedMotion,
  useScroll, useSpring, useTransform, type MotionValue,
} from "motion/react";
import { Eye, LogoMark, SketchPath, Star } from "@/components/sketch";
import { ThemeToggle } from "@/components/theme";
import { brushRing, lemniscate, lemniscatePoint, sparkle } from "@/lib/sketch";
import { useSceneProgress } from "@/lib/use-scene-progress";

const DAY = "/brand/finity-banner.webp";
const NIGHT = "/brand/finity-dark-banner.webp";
const REPO = "https://github.com/Ithaca-Labs/zcash";

export function SmoothScroll() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true, wheelMultiplier: 0.9, anchors: true });
    let id = requestAnimationFrame(function raf(time) { lenis.raf(time); id = requestAnimationFrame(raf); });
    return () => { cancelAnimationFrame(id); lenis.destroy(); };
  }, []);
  return null;
}

/* ---------------- Nav ---------------- */

export function Nav() {
  const { scrollYProgress } = useScroll();
  const spin = useTransform(scrollYProgress, [0, 1], [0, 720]);
  return (
    <header className="l-nav">
      <a href="#top" className="l-pill l-brand" aria-label="finity, back to top">
        <motion.span style={{ rotate: spin }} className="l-brand-mark"><LogoMark detail={2} /></motion.span>
        <span>finity</span>
      </a>
      <nav className="l-pill l-links" aria-label="Primary">
        <a href="#loop">How it works</a>
        <a href="#public">Privacy</a>
        <Link href="/wallet" className="l-cta">Open wallet ↗</Link>
        <ThemeToggle />
      </nav>
    </header>
  );
}

/* ---------------- Hero: the lens ---------------- */

const RING = brushRing(100, 100, 84);
/** The banner's own star: centre and width as percentages of the art. */
const ART_STAR = { x: 50.1, y: 33.8, w: 6.17 };
const PAPER_INK = { "--ink": "var(--paper)", "--ink-2": "var(--paper)", "--ink-3": "var(--paper)" } as CSSProperties;

function Art({ light, dark, children }: { light: string; dark: string; children?: ReactNode }) {
  return (
    <div className="l-art">
      <img src={light} alt="" className="only-light" />
      <img src={dark} alt="" className="only-dark" />
      {children}
    </div>
  );
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const p = useSceneProgress(ref, ["start start", "end end"], 0.75);

  // Lens target: the mouse when there is one, otherwise a slow drift along an ∞.
  const w = useMotionValue(0), h = useMotionValue(0), tx = useMotionValue(0), ty = useMotionValue(0);
  const lx = useSpring(tx, { stiffness: 140, damping: 22, mass: 0.6 });
  const ly = useSpring(ty, { stiffness: 140, damping: 22, mass: 0.6 });
  const lastPointer = useRef(-Infinity);

  useEffect(() => {
    const el = artRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { w.set(e.contentRect.width); h.set(e.contentRect.height); });
    ro.observe(el);
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      tx.set(e.clientX - r.left); ty.set(e.clientY - r.top);
      lastPointer.current = performance.now();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { ro.disconnect(); window.removeEventListener("pointermove", onMove); };
  }, [w, h, tx, ty]);

  useAnimationFrame((time) => {
    if (reduced || performance.now() - lastPointer.current < 2500) return;
    const s = Math.PI / 2 + (time / 11000) * Math.PI * 2;
    const k = 1 + Math.sin(s) ** 2;
    const a = Math.min(w.get() * 0.28, 300);
    tx.set(w.get() / 2 + (a * Math.cos(s)) / k);
    ty.set(h.get() / 2 + (a * 0.9 * Math.sin(s) * Math.cos(s)) / k);
  });

  // Scroll: the lens swallows the art, the art dissolves, the headline arrives.
  const grow = useTransform(p, [0.02, 0.4], [0, 1], { ease: (t) => t * t });
  const lensX = useTransform([lx, grow, w], ([x, g, W]: number[]) => x + (W / 2 - x) * g);
  const lensY = useTransform([ly, grow, h], ([y, g, H]: number[]) => y + (H / 2 - y) * g);
  const lensR = useTransform([grow, w, h], ([g, W, H]: number[]) => { const r0 = Math.max(56, Math.min(W, H) * 0.17); return r0 + (Math.hypot(W, H) - r0) * g; });
  const clip = useMotionTemplate`circle(${lensR}px at ${lensX}px ${lensY}px)`;
  const ringX = useTransform(lensX, (x) => x - 100);
  const ringY = useTransform(lensY, (y) => y - 100);
  const ringScale = useTransform(lensR, (r) => r / 84);
  const ringOpacity = useTransform(grow, [0.1, 0.45], [1, 0]);
  const artOpacity = useTransform(p, [0.38, 0.58], [1, 0]);
  const artScale = useTransform(p, [0.38, 0.58], [1, 1.06]);
  const headOpacity = useTransform(p, [0.5, 0.66, 0.88, 0.99], [0, 1, 1, 0]);
  const headY = useTransform(p, [0.5, 0.66, 0.88, 0.99], [40, 0, 0, -30]);
  const headEvents = useTransform(headOpacity, (o) => (o > 0.5 ? "auto" : "none"));
  const cueOpacity = useTransform(p, [0, 0.06], [1, 0]);

  return (
    <section ref={ref} data-scene="hero" className="pin l-hero" aria-labelledby="hero-title">
      <div className="pin-stage">
        <motion.div ref={artRef} style={{ opacity: artOpacity, scale: artScale }} className="l-hero-art">
          {/* Outside the lens: the other side of the brand. */}
          <Art light={NIGHT} dark={DAY}>
            <div data-star="art" className="l-art-star" style={{ left: `${ART_STAR.x}%`, top: `${ART_STAR.y}%`, width: `${ART_STAR.w}%` }} />
          </Art>
          {/* Inside the lens: this theme's banner. */}
          <motion.div className="l-fill" style={{ clipPath: clip }}><Art light={DAY} dark={NIGHT} /></motion.div>
          <motion.div aria-hidden className="l-lens-ring" style={{ x: ringX, y: ringY, scale: ringScale, opacity: ringOpacity, ...PAPER_INK }}>
            <svg viewBox="0 0 200 200"><SketchPath d={RING} width={5} passes={3} /></svg>
          </motion.div>
        </motion.div>

        <motion.div style={{ opacity: headOpacity, y: headY, pointerEvents: headEvents }} className="l-hero-head">
          <div data-star="rest" className="l-star-rest"><Star className="l-star-still" /></div>
          <h1 id="hero-title">Trade in the open.<br />Come home <em>shielded.</em></h1>
          <p>A wallet for the round trip: shielded ZEC out to a fresh Hyperliquid account, and back home again. You keep the keys the whole way.</p>
          <div className="l-hero-cta">
            <Link href="/wallet" className="btn btn-lg">Open the wallet</Link>
            <a href="#loop" className="btn btn-lg btn-ghost">See how it works</a>
          </div>
        </motion.div>

        <motion.div style={{ opacity: cueOpacity }} className="l-cue">
          <span>Zcash × Hyperliquid</span>
          <span className="l-cue-scroll"><Star className="l-spin" />Scroll</span>
          <span className="l-hide-sm">Testnet · Experimental</span>
        </motion.div>
      </div>
    </section>
  );
}

/* ---------------- Star handoff ---------------- */

const SIZE = 100;
const STAR_SPAN = (SIZE * 30) / 34;
type Stop = { scene: string; p: number; anchor: string };
const STOPS: Stop[] = [
  { scene: "hero", p: 0.4, anchor: "art" },
  { scene: "hero", p: 0.62, anchor: "rest" },
  { scene: "hero", p: 1, anchor: "rest" },
  { scene: "loop", p: 0.16, anchor: "to" },
];
const HANDOFF_LAND = STOPS[STOPS.length - 1].p;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** One star that travels between scenes, following invisible anchors so the path holds at any size. */
export function StarHandoff() {
  const reduced = useReducedMotion();
  const { scrollY } = useScroll();
  const x = useMotionValue(0), y = useMotionValue(0), scale = useMotionValue(0), rotate = useMotionValue(0), opacity = useMotionValue(0);

  const update = () => {
    if (reduced) return opacity.set(0);
    const sy = window.scrollY, vh = window.innerHeight;
    const at = ({ scene, p }: Stop) => {
      const el = document.querySelector<HTMLElement>(`[data-scene="${scene}"]`);
      return el ? el.getBoundingClientRect().top + sy + p * (el.offsetHeight - vh) : NaN;
    };
    const rect = (s: Stop) => document.querySelector(`[data-star="${s.anchor}"]`)?.getBoundingClientRect();
    const ys = STOPS.map(at);
    const i = ys.findIndex((v, k) => k < ys.length - 1 && sy >= v && sy < ys[k + 1]);
    if (i < 0) return opacity.set(0);
    const a = rect(STOPS[i]), b = rect(STOPS[i + 1]);
    if (!a || !b) return opacity.set(0);
    const t = smooth((sy - ys[i]) / (ys[i + 1] - ys[i]));
    const lerp = (u: number, v: number) => u + (v - u) * t;
    const long = i === STOPS.length - 2;
    const swing = long ? Math.sin(Math.PI * t) * -Math.min(160, window.innerWidth * 0.18) : 0;
    const cy = lerp(a.top + a.height / 2, b.top + b.height / 2);
    x.set(lerp(a.left + a.width / 2, b.left + b.width / 2) - SIZE / 2 + swing);
    y.set((long ? Math.min(Math.max(cy, vh * 0.14), vh * 0.86) : cy) - SIZE / 2);
    scale.set(lerp(a.width, b.width) / STAR_SPAN);
    rotate.set(((sy - ys[0]) / (ys[ys.length - 1] - ys[0])) * 360);
    opacity.set(i === 0 ? Math.min(1, t * 4) : 1);
  };

  useMotionValueEvent(scrollY, "change", update);
  useEffect(() => { update(); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update); });

  return (
    <motion.svg aria-hidden viewBox="-17 -17 34 34" className="l-handoff" width={SIZE} height={SIZE} style={{ x, y, scale, rotate, opacity }}>
      <path d={sparkle(0, 0, 15)} fill="var(--ink)" filter="url(#brush)" />
      <path d={sparkle(-1.5, -1.5, 6)} fill="var(--ink-3)" opacity="0.8" />
    </motion.svg>
  );
}

/* ---------------- The loop: the round trip as an infinity sign ---------------- */

const CX = 150, CY = 100, A = 118;
const LOOP_RING = brushRing(150, 100, 92);
const LOOP = lemniscate({ cx: CX, cy: CY, a: A });
const START_T = 0.25; // far left of the Zcash loop
const [SX, SY] = lemniscatePoint(CX, CY, A, START_T);

const BEATS = [
  { kicker: "01 · The loop", title: "Out and back, by design.", body: "finity is a round trip for shielded ZEC: out to Hyperliquid to trade, and home again to your shielded wallet." },
  { kicker: "02 · Fund", title: "Cross the bridge.", body: "Send from your shielded wallet. After 100 Zcash confirmations, Unit's guardians mint it into a fresh Hyperliquid account with no link to your history." },
  { kicker: "03 · Trade", title: "Trade in the open.", body: "Swap to USDC and go long or short. Hyperliquid is public by design, which is why the account is brand new." },
  { kicker: "04 · Return", title: "Come home shielded.", body: "Buy ZEC back, send it to a fresh address in your wallet, and shield it with one tap. Every coin is tracked on the way." },
];

function Beat({ beat, p, range, last }: { beat: (typeof BEATS)[number]; p: MotionValue<number>; range: [number, number]; last?: boolean }) {
  const [a, b] = range;
  const opacity = useTransform(p, [a - 0.05, a, b - 0.04, b], [0, 1, 1, last ? 1 : 0]);
  const y = useTransform(p, [a - 0.05, a], [24, 0]);
  return <motion.div style={{ opacity, y }} className="l-beat"><BeatCopy beat={beat} /></motion.div>;
}
function BeatCopy({ beat }: { beat: (typeof BEATS)[number] }) {
  return (<><p className="eyebrow">{beat.kicker}</p><h2>{beat.title}</h2><p className="l-beat-body">{beat.body}</p></>);
}

export function LoopScene() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const p = useSceneProgress(ref, ["start start", "end end"]);

  const ringDraw = useTransform(p, [0.02, 0.16, 0.24, 0.32], [0, 1, 1, 0]);
  const loopDraw = useTransform(p, [0.04, 0.22], [0, 1]);
  const labels = useTransform(p, [0.22, 0.3], [0, 1]);
  const starScale = useTransform(p, [HANDOFF_LAND - 0.001, HANDOFF_LAND], [0, 1]);

  // The star rides the loop: Zcash → bridge → Hyperliquid (fund), orbits (trade), then home (return).
  const t = useTransform(p, [0.3, 0.48, 0.56, 0.74, 0.8, 0.96], [START_T, 0.6, 0.6, 0.92, 0.92, 1.25], { ease: (u) => u * u * (3 - 2 * u) });
  const sx = useTransform(t, (v) => lemniscatePoint(CX, CY, A, v % 1)[0]);
  const sy = useTransform(t, (v) => lemniscatePoint(CX, CY, A, v % 1)[1]);
  const spin = useTransform(p, [0.3, 0.96], [0, 540]);
  const shield = useTransform(p, [0.93, 1], [0, 1]);
  const zcashOn = useTransform(p, [0.28, 0.32, 0.46, 0.5, 0.92, 0.96], [0.45, 1, 1, 0.45, 0.45, 1]);
  const hlOn = useTransform(p, [0.46, 0.5, 0.78, 0.82], [0.45, 1, 1, 0.45]);
  const bridgeOn = useTransform(p, [0.38, 0.42, 0.46, 0.84, 0.88, 0.92], [0.4, 1, 0.4, 0.4, 1, 0.4]);
  const shieldRing = brushRing(SX, SY, 22);

  return (
    <section ref={ref} id="loop" data-scene="loop" className="pin l-loop" aria-label="How finity works">
      <div className="pin-stage l-loop-stage">
        <svg viewBox="0 0 300 200" className="l-loop-svg" role="img" aria-label="The round trip drawn as an infinity loop: Zcash on the left, Hyperliquid on the right, the bridge where they cross">
          <SketchPath d={LOOP_RING} width={6} progress={ringDraw} />
          <SketchPath d={LOOP} width={7} progress={loopDraw} />
          <motion.g style={{ opacity: labels }} className="l-loop-labels">
            <motion.text x={CX - A * 0.6} y={CY + 70} textAnchor="middle" style={{ opacity: zcashOn }}>Zcash · shielded</motion.text>
            <motion.text x={CX + A * 0.6} y={CY + 70} textAnchor="middle" style={{ opacity: hlOn }}>Hyperliquid · public</motion.text>
            <motion.g style={{ opacity: bridgeOn }}>
              <line x1={CX} y1={CY - 56} x2={CX} y2={CY - 10} stroke="var(--ink)" strokeWidth="1" strokeDasharray="2 3" />
              <text x={CX} y={CY - 62} textAnchor="middle">bridge · ~2h</text>
            </motion.g>
          </motion.g>
          <motion.g style={{ opacity: shield }}><SketchPath d={shieldRing} width={3} progress={shield} passes={2} /></motion.g>
          {/* Landing spot for StarHandoff. */}
          <rect data-star="to" x={SX - 13} y={SY - 14} width={26} height={28} fill="none" />
          <motion.g style={{ x: sx, y: sy, rotate: spin, scale: starScale }}>
            <path d={sparkle(0, 0, 13)} fill="var(--ink)" filter="url(#brush)" />
            <path d={sparkle(-1.3, -1.3, 5)} fill="var(--ink-3)" opacity="0.8" />
          </motion.g>
        </svg>
        <div className="l-beats">
          {reduced ? <div className="l-beats-still">{BEATS.map((b) => <div key={b.kicker}><BeatCopy beat={b} /></div>)}</div> : (
            <div className="l-beat-grid">
              <Beat beat={BEATS[0]} p={p} range={[0.06, 0.3]} />
              <Beat beat={BEATS[1]} p={p} range={[0.34, 0.5]} />
              <Beat beat={BEATS[2]} p={p} range={[0.54, 0.76]} />
              <Beat beat={BEATS[3]} p={p} range={[0.8, 1]} last />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Steps: a thread with three stars ---------------- */

const STEPS = [
  { n: "01", title: "Fund", time: "~2 hours", body: "Scan one QR code from your Zcash wallet. The deposit address is checked against 2 of 3 bridge guardians before you see it.", href: "/fund" },
  { n: "02", title: "Trade", time: "seconds", body: "Swap ZEC to USDC and trade BTC or ETH. Every order is reviewed before you sign it, and closing is never blocked.", href: "/trade" },
  { n: "03", title: "Return", time: "~2 hours", body: "Buy ZEC back and send it home to a fresh address. We follow it until you tap shield in your wallet.", href: "/return" },
];
const NODES = [166, 500, 834];
const THREAD = "M10 44 C80 10 120 70 166 40 S260 8 330 44 S430 74 500 40 S600 6 670 42 S780 72 834 40 S930 20 990 36";

function Node({ x, at, p }: { x: number; at: number; p: MotionValue<number> }) {
  const scale = useTransform(p, [at - 0.04, at + 0.04], [0, 1]);
  return <motion.path d={sparkle(x, 40, 16)} fill="var(--ink)" filter="url(#brush)" style={{ scale, originX: `${x}px`, originY: "40px" }} />;
}

export function Steps() {
  const ref = useRef<HTMLElement>(null);
  const p = useSceneProgress(ref, ["start 75%", "center 45%"]);
  return (
    <section ref={ref} className="l-section" aria-labelledby="steps-title">
      <p className="eyebrow">Three screens</p>
      <h2 id="steps-title" className="l-h2">Fund. Trade. <em>Return.</em></h2>
      <svg viewBox="0 0 1000 80" className="l-thread" aria-hidden>
        <SketchPath d={THREAD} width={5} progress={p} passes={3} />
        {NODES.map((x) => <Node key={x} x={x} at={(x - 10) / 980} p={p} />)}
      </svg>
      <ol className="l-steps">
        {STEPS.map((s, i) => (
          <motion.li key={s.n} initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-15% 0px" }}
            transition={{ duration: 0.8, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}>
            <Link href={s.href}>
              <span className="l-step-n">{s.n} · {s.time}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <span className="l-step-go">Open {s.title.toLowerCase()} ↗</span>
            </Link>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

/* ---------------- Watched: what is public ---------------- */

const CLAIMS = [
  "The bridge leg is visible: amounts leaving and returning to Zcash, and the short transparent handoff, are on-chain.",
  "Trading is public on Hyperliquid: deposits, positions, fills and PnL. What stays hidden is the link back to your wallet.",
  "finity holds nothing. Your keys stay in your tab; Unit's guardians hold the backing ZEC only while it is bridged.",
];

export function Watched() {
  const eyesRef = useRef<HTMLDivElement>(null);
  const inView = useInView(eyesRef, { margin: "-20% 0px", once: true });
  const reduced = useReducedMotion();
  const open = inView || !!reduced;
  return (
    <section id="public" className="l-section l-center" aria-labelledby="watched-title">
      <p className="eyebrow">Straight talk</p>
      <h2 id="watched-title" className="l-h2">Who&apos;s <em>watching.</em></h2>
      <div ref={eyesRef} className="l-eyes">
        {[0, 1, 2, 3, 4].map((i) => (
          <Eye key={i} seed={i * 7 + 3} open={open} delay={Math.abs(i - 2) * 0.12} className={`l-eye${i === 0 || i === 4 ? " l-hide-sm" : ""}${i % 2 ? " l-eye-low" : ""}`} />
        ))}
      </div>
      <ul className="l-claims">
        {CLAIMS.map((c, i) => (
          <motion.li key={i} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ duration: 0.8, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}>
            <Star className="l-claim-star" />{c}
          </motion.li>
        ))}
      </ul>
      <p className="l-disclaimer">Experimental software · testnet only · not audited. Mainnet funding and return are switched off.</p>
    </section>
  );
}

/* ---------------- Finale: through the logo ---------------- */

const RING_VMIN = 12.6;

export function Finale() {
  const ref = useRef<HTMLElement>(null);
  const p = useSceneProgress(ref, ["start start", "end end"]);
  const radius = useTransform(p, [0.08, 0.85], [RING_VMIN, 160], { ease: (t) => t * t });
  const clip = useMotionTemplate`circle(${radius}vmin at 50% 50%)`;
  const markScale = useTransform(radius, (r) => r / RING_VMIN);
  const markOpacity = useTransform(p, [0.3, 0.55], [1, 0]);
  const lineOpacity = useTransform(p, [0, 0.15], [1, 0]);
  const endOpacity = useTransform(p, [0.78, 0.92], [0, 1]);
  const endEvents = useTransform(endOpacity, (o) => (o > 0.5 ? "auto" : "none"));
  return (
    <>
      <section ref={ref} className="pin l-finale" aria-labelledby="finale-title">
        <div className="pin-stage l-finale-stage">
          <motion.div className="l-fill" style={{ clipPath: clip }}>
            <img src={NIGHT} alt="" className="only-light l-cover" />
            <img src={DAY} alt="" className="only-dark l-cover" />
          </motion.div>
          <motion.div style={{ scale: markScale, opacity: markOpacity }} className="l-finale-mark"><LogoMark /></motion.div>
          <motion.h2 id="finale-title" style={{ opacity: lineOpacity }} className="l-finale-title">Close the <em>loop.</em></motion.h2>
          <motion.div style={{ opacity: endOpacity, pointerEvents: endEvents }} className="l-finale-cta">
            <Link href="/wallet" className="l-finale-primary">Open the finity wallet</Link>
            <a href={REPO} className="l-finale-secondary">GitHub</a>
          </motion.div>
        </div>
      </section>
      <footer className="l-footer">
        <div className="l-footer-brand"><LogoMark detail={2} /><span>finity</span></div>
        <p><Star className="l-claim-star" /> Experimental · testnet · not audited</p>
        <p>Zcash × Hyperliquid · 2026</p>
      </footer>
    </>
  );
}
