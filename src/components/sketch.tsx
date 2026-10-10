"use client";
// Finity's hand-drawn system: shared filters, bristle strokes that draw themselves, the logo, star and eye.
import { useEffect, useId, useRef } from "react";
import { animate, isMotionValue, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { brushRing, lemniscate, sparkle } from "@/lib/sketch";

/** Shared SVG filters, mounted once. `brush` warps a stroke and eats speckles out of it; `rough` only warps. */
export function SketchDefs() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <filter id="brush" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="9" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.4 0 0 0 1.75" result="mask" />
          <feComposite in="rough" in2="mask" operator="in" />
        </filter>
        <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="2" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="3" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink)" strokeWidth="1.4" />
        </pattern>
      </defs>
    </svg>
  );
}

/** Bristle passes: a heavy base plus lighter offset strokes, like the logo's streaks. */
const PASSES = [
  { dx: 0, dy: 0, w: 1, color: "var(--ink)", opacity: 1 },
  { dx: 0.9, dy: -0.8, w: 0.45, color: "var(--ink-2)", opacity: 0.9 },
  { dx: -0.7, dy: 0.9, w: 0.3, color: "var(--ink-3)", opacity: 0.8 },
  { dx: 0.3, dy: 1.5, w: 0.2, color: "var(--ink)", opacity: 0.7 },
];

type SketchPathProps = {
  d: string | MotionValue<string>;
  width?: number;
  /** 0–1 draw progress; omit to show the full stroke. */
  progress?: MotionValue<number> | number;
  passes?: number;
  filter?: "brush" | "rough" | "none";
  dashed?: boolean;
};

/** One mark, rendered as several bristle strokes that draw together. */
export function SketchPath({ d, width = 6, progress, passes = PASSES.length, filter = "brush", dashed }: SketchPathProps) {
  // Round caps paint a dot even at zero length; hide the mark until it starts drawing.
  const full = useMotionValue(typeof progress === "number" ? progress : 1);
  useEffect(() => { if (typeof progress === "number") full.set(progress); }, [progress, full]);
  const source = isMotionValue(progress) ? progress : full;
  const drawn = useTransform(source, (v) => (v > 0.005 ? 1 : 0));
  return (
    <motion.g filter={filter === "none" ? undefined : `url(#${filter})`} style={{ opacity: drawn }}>
      {PASSES.slice(0, passes).map((p, i) => (
        <motion.path
          key={i}
          d={d}
          fill="none"
          stroke={p.color}
          strokeOpacity={p.opacity}
          strokeWidth={width * p.w}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dashed ? `${width * 0.6} ${width * 1.4}` : undefined}
          transform={`translate(${p.dx * width * 0.35} ${p.dy * width * 0.35})`}
          style={progress === undefined || dashed ? undefined : { pathLength: source }}
        />
      ))}
    </motion.g>
  );
}

/** A mark that draws itself once when mounted (or when `play` flips true). */
export function DrawOn({ d, width = 6, passes = 3, delay = 0, duration = 1.1, play = true, filter }: Omit<SketchPathProps, "progress"> & { delay?: number; duration?: number; play?: boolean }) {
  const reduced = useReducedMotion();
  const p = useMotionValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    if (!play) { p.set(0); return; }
    const c = animate(p, 1, { duration, delay, ease: [0.65, 0, 0.35, 1] });
    return () => c.stop();
  }, [play, reduced, p, delay, duration]);
  return <SketchPath d={d} width={width} passes={passes} progress={p} filter={filter} />;
}

const RING = brushRing(100, 100, 84);
const LOOP = lemniscate({ cx: 100, cy: 116, a: 64 });
const STAR = sparkle(100, 60, 15);

/** Vector rebuild of the logo: brush ring, infinity loop and star. `draw` animates it in. */
export function LogoMark({ className, ring = true, detail = 4, draw = false }: { className?: string; ring?: boolean; detail?: number; draw?: boolean }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      {draw ? (<>
        {ring && <DrawOn d={RING} width={9} passes={detail} duration={1.2} />}
        <DrawOn d={LOOP} width={11} passes={detail} delay={0.25} duration={1.3} />
        <motion.path d={STAR} fill="var(--ink)" filter="url(#brush)" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 1.1, type: "spring", stiffness: 260, damping: 14 }} style={{ originX: "100px", originY: "60px" }} />
      </>) : (<>
        {ring && <SketchPath d={RING} width={9} passes={detail} />}
        <SketchPath d={LOOP} width={11} passes={detail} />
        <path d={STAR} fill="var(--ink)" filter="url(#brush)" />
      </>)}
    </svg>
  );
}

/** The logo's four-point star, filled with the current text colour. */
export function Star({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={sparkle(12, 12.6, 10)} fill="currentColor" filter="url(#rough)" />
    </svg>
  );
}

const LID_TOP = "M6 30 C30 4 90 4 114 30";
const LID_BOTTOM = "M6 30 C30 54 90 54 114 30";

/** Banner eye: almond lids, an iris that follows the pointer, and an occasional blink. */
export function Eye({ className, open = true, seed = 0, delay = 0 }: { className?: string; open?: boolean; seed?: number; delay?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const clipId = `almond${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const reduced = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const x = useSpring(px, { stiffness: 120, damping: 18 });
  const y = useSpring(py, { stiffness: 120, damping: 18 });
  const lid = useMotionValue(open ? 1 : 0.06);

  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, dist / 400);
      px.set((dx / dist) * 22 * reach);
      py.set((dy / dist) * 7 * reach);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [px, py, reduced]);

  useEffect(() => {
    const opening = animate(lid, open ? 1 : 0.06, { duration: reduced ? 0 : 0.7, delay: reduced ? 0 : delay, ease: [0.22, 1, 0.36, 1] });
    if (!open || reduced) return () => opening.stop();
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let n = seed;
    const blink = () => {
      n = (n * 9301 + 49297) % 233280;
      timer = setTimeout(async () => {
        await animate(lid, 0.06, { duration: 0.08 });
        await animate(lid, 1, { duration: 0.16 });
        if (alive) blink();
      }, 2600 + (n / 233280) * 4200);
    };
    blink();
    return () => { alive = false; opening.stop(); clearTimeout(timer); };
  }, [open, reduced, lid, seed, delay]);

  return (
    <svg ref={ref} viewBox="0 0 120 64" className={className} aria-hidden>
      <motion.g style={{ scaleY: lid, originY: "30px" }}>
        <clipPath id={clipId}><path d={`${LID_TOP} C90 56 30 56 6 30Z`} /></clipPath>
        <g clipPath={`url(#${clipId})`}>
          <motion.g style={{ x, y }}>
            <circle cx="60" cy="30" r="15" fill="none" stroke="var(--ink)" strokeWidth="2.6" filter="url(#rough)" />
            <circle cx="60" cy="30" r="9" fill="url(#hatch)" />
            <ellipse cx="60" cy="30" rx="3.2" ry="8.5" fill="var(--ink)" />
            <circle cx="55" cy="25" r="2.4" fill="var(--paper)" />
          </motion.g>
        </g>
        <g filter="url(#brush)" fill="none" stroke="var(--ink)" strokeLinecap="round">
          <path d={LID_TOP} strokeWidth="5" />
          <path d="M14 27 C36 9 84 9 106 27" strokeWidth="1.6" stroke="var(--ink-2)" />
          <path d={LID_BOTTOM} strokeWidth="3.4" />
        </g>
      </motion.g>
      <g stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" filter="url(#rough)">
        <path d="M44 52 l-2 8" /><path d="M60 54 l0 8" /><path d="M76 52 l2 8" />
      </g>
    </svg>
  );
}

/** A drawn check mark with a star burst, for "done" moments. */
export function DoneMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <DrawOn d={brushRing(60, 60, 46)} width={6} duration={0.9} />
      <DrawOn d="M38 62 L54 77 L84 44" width={8} delay={0.55} duration={0.5} />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <motion.path key={i} d={sparkle(60 + Math.cos(a) * 58, 60 + Math.sin(a) * 58, 5)} fill="var(--ink)"
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.3, 1], opacity: [0, 1, 0.9] }}
            transition={{ delay: 1 + i * 0.05, duration: 0.5 }} style={{ originX: `${60 + Math.cos(a) * 58}px`, originY: `${60 + Math.sin(a) * 58}px` }} />
        );
      })}
    </svg>
  );
}
