// Finity's hand-drawn marks (brush ring, infinity loop, four-point star), as plain SVG.
// Geometry and filters are ported from the Finity web app so the mark matches the brand art.

/** Lemniscate drawn from the centre crossing, with the logo's fuller loops. */
function lemniscate(cx: number, cy: number, a: number, steps = 160) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const s = Math.PI / 2 + (i / steps) * Math.PI * 2;
    const k = 1 + Math.sin(s) ** 2;
    d += `${i ? "L" : "M"}${(cx + (a * Math.cos(s)) / k).toFixed(2)} ${(cy + (1.25 * a * Math.sin(s) * Math.cos(s)) / k).toFixed(2)}`;
  }
  return d;
}

/** Four-point sparkle; the top point is the longest. */
function sparkle(cx: number, cy: number, r: number) {
  const t = r * 1.2, b = r * 1.05, p = r * 0.16;
  return [
    `M${cx} ${cy - t}`,
    `C${cx + p} ${cy - p * 2} ${cx + p * 2} ${cy - p} ${cx + r} ${cy}`,
    `C${cx + p * 2} ${cy + p} ${cx + p} ${cy + p * 2} ${cx} ${cy + b}`,
    `C${cx - p} ${cy + p * 2} ${cx - p * 2} ${cy + p} ${cx - r} ${cy}`,
    `C${cx - p * 2} ${cy - p} ${cx - p} ${cy - p * 2} ${cx} ${cy - t}Z`,
  ].join("");
}

/** A brush circle: slightly elliptical, overshooting its start like the logo's ring. */
function brushRing(cx: number, cy: number, r: number, overshoot = 0.12) {
  let d = "";
  for (let i = 0; i <= 120; i++) {
    const t = -Math.PI * 0.6 + (i / 120) * Math.PI * 2 * (1 + overshoot);
    const w = 1 + 0.018 * Math.sin(t * 3) + 0.01 * Math.cos(t * 5);
    d += `${i ? "L" : "M"}${(cx + r * 1.01 * w * Math.cos(t)).toFixed(2)} ${(cy + r * 0.985 * w * Math.sin(t)).toFixed(2)}`;
  }
  return d;
}

const RING = brushRing(100, 100, 84);
const LOOP = lemniscate(100, 116, 64);
const STAR = sparkle(100, 60, 15);
const SMALL_STAR = sparkle(12, 12.6, 10);

/** Shared SVG filters, mounted once in the layout. */
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
      </defs>
    </svg>
  );
}

/** Bristle passes: a heavy base plus lighter offset strokes. */
const PASSES = [
  { dx: 0, dy: 0, w: 1, color: "var(--ink)", opacity: 1 },
  { dx: 0.9, dy: -0.8, w: 0.45, color: "var(--ink-2)", opacity: 0.9 },
  { dx: -0.7, dy: 0.9, w: 0.3, color: "var(--ink-3)", opacity: 0.8 },
  { dx: 0.3, dy: 1.5, w: 0.2, color: "var(--ink)", opacity: 0.7 },
];

function Brush({ d, width, passes }: { d: string; width: number; passes: number }) {
  return (
    <g filter="url(#brush)">
      {PASSES.slice(0, passes).map((p, i) => (
        <path key={i} d={d} fill="none" stroke={p.color} strokeOpacity={p.opacity} strokeWidth={width * p.w}
          strokeLinecap="round" strokeLinejoin="round" transform={`translate(${p.dx * width * 0.35} ${p.dy * width * 0.35})`} />
      ))}
    </g>
  );
}

export function LogoMark({ className, detail = 2 }: { className?: string; detail?: number }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <Brush d={RING} width={9} passes={detail} />
      <Brush d={LOOP} width={11} passes={detail} />
      <path d={STAR} fill="var(--ink)" filter="url(#brush)" />
    </svg>
  );
}

/** The logo's star, filled with the current text colour. */
export function Star({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={SMALL_STAR} fill="currentColor" filter="url(#rough)" />
    </svg>
  );
}

/** A loose brush underline for a headline word. */
export function Scribble({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 20" preserveAspectRatio="none" className={className} aria-hidden>
      <Brush d="M4 13 C40 6 80 5 120 8 S180 13 196 9" width={5} passes={3} />
    </svg>
  );
}
