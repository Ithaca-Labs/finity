/**
 * Geometry for Finity's hand-drawn marks, as plain SVG path strings so the same
 * shapes can be drawn, morphed and scrubbed by scroll. Ported from the Finity web app.
 */

type LemniscateOpts = { cx: number; cy: number; a: number; sx?: number; sy?: number; steps?: number };

/** Lemniscate of Bernoulli drawn from the centre crossing; the 1.25 factor matches the logo's fuller loops. */
export function lemniscate({ cx, cy, a, sx = 1, sy = 1, steps = 160 }: LemniscateOpts) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const [x, y] = lemniscatePoint(cx, cy, a, i / steps, sx, sy);
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

/** Point at fraction t (0..1) along the lemniscate, starting at the centre crossing heading right-up. */
export function lemniscatePoint(cx: number, cy: number, a: number, t: number, sx = 1, sy = 1): [number, number] {
  const s = Math.PI / 2 + t * Math.PI * 2;
  const k = 1 + Math.sin(s) ** 2;
  return [cx + (sx * a * Math.cos(s)) / k, cy + (sy * 1.25 * a * Math.sin(s) * Math.cos(s)) / k];
}

/** Four-point sparkle from the logo; the top point is the longest. */
export function sparkle(cx: number, cy: number, r: number) {
  const t = r * 1.2, b = r * 1.05, p = r * 0.16;
  return [
    `M${cx} ${cy - t}`,
    `C${cx + p} ${cy - p * 2} ${cx + p * 2} ${cy - p} ${cx + r} ${cy}`,
    `C${cx + p * 2} ${cy + p} ${cx + p} ${cy + p * 2} ${cx} ${cy + b}`,
    `C${cx - p} ${cy + p * 2} ${cx - p * 2} ${cy + p} ${cx - r} ${cy}`,
    `C${cx - p * 2} ${cy - p} ${cx - p} ${cy - p * 2} ${cx} ${cy - t}Z`,
  ].join("");
}

/** A circle drawn the way a brush would: slightly elliptical, overshooting its start like the logo's ring. */
export function brushRing(cx: number, cy: number, r: number, overshoot = 0.12) {
  let d = "";
  for (let i = 0; i <= 120; i++) {
    const t = -Math.PI * 0.6 + (i / 120) * Math.PI * 2 * (1 + overshoot);
    const w = 1 + 0.018 * Math.sin(t * 3) + 0.01 * Math.cos(t * 5);
    d += `${i ? "L" : "M"}${(cx + r * 1.01 * w * Math.cos(t)).toFixed(2)} ${(cy + r * 0.985 * w * Math.sin(t)).toFixed(2)}`;
  }
  return d;
}

/** A brush rectangle with softened corners and a slight overshoot, for framing QR codes and cards. */
export function brushRect(x: number, y: number, w: number, h: number, r = 14) {
  return `M${x + r} ${y - 1} L${x + w - r} ${y + 1} Q${x + w + 1} ${y} ${x + w} ${y + r} L${x + w + 1} ${y + h - r} Q${x + w} ${y + h + 1} ${x + w - r} ${y + h} L${x + r} ${y + h + 1} Q${x - 1} ${y + h} ${x} ${y + h - r} L${x - 1} ${y + r} Q${x} ${y - 1} ${x + r + 6} ${y}`;
}
