"use client";
// Wallet building blocks: animated numbers, step flows, sheets, trackers, token rows and icons.
import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { Star } from "@/components/sketch";

export const EASE = [0.22, 1, 0.36, 1] as const;

/** A number that springs to its new value. */
export function Ticker({ value, decimals = 2, className }: { value: number; decimals?: number; className?: string }) {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 90, damping: 20 });
  const text = useTransform(spring, (v) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  useEffect(() => { mv.set(Number.isFinite(value) ? value : 0); }, [value, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** Header of a step flow: back, title, progress dots. */
export function FlowHead({ title, step, total, onBack }: { title: string; step: number; total: number; onBack?: () => void }) {
  return (
    <div className="flow-head">
      <button type="button" className="icon-btn" onClick={onBack} disabled={!onBack} aria-label="Back" style={{ visibility: onBack ? "visible" : "hidden" }}>
        <svg viewBox="0 0 24 24" width="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <div className="flow-title">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>{title}</motion.span>
        </AnimatePresence>
        <div className="dots" aria-label={`Step ${step + 1} of ${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <motion.i key={i} animate={{ width: i === step ? 18 : 6, opacity: i <= step ? 1 : 0.3 }} transition={{ duration: 0.35, ease: EASE }} />
          ))}
        </div>
      </div>
      <span className="icon-btn" aria-hidden style={{ visibility: "hidden" }} />
    </div>
  );
}

/** Slides between steps; direction follows the step index. */
export function StepView({ k, dir, children }: { k: string; dir: number; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false} custom={dir}>
      <motion.div key={k} custom={dir} className="step"
        variants={{ enter: (d: number) => ({ opacity: 0, x: d * 40 }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: d * -40 }) }}
        initial="enter" animate="center" exit="exit" transition={{ duration: 0.32, ease: EASE }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Children rise in one after another. */
export function Rise({ children, i = 0, className }: { children: ReactNode; i?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05 + i * 0.06, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/** Bottom sheet inside the wallet card. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (<>
        <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
        <motion.div className="sheet" role="dialog" aria-label={title} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}>
          <div className="sheet-grip" />
          <div className="sheet-head"><h3>{title}</h3><button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
          {children}
        </motion.div>
      </>)}
    </AnimatePresence>
  );
}

export function Callout({ tone, title, children, mark }: { tone?: "warn" | "bad" | "ok"; title?: ReactNode; children?: ReactNode; mark?: string }) {
  return (
    <motion.div className={`callout ${tone ?? ""}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      <span className="callout-mark">{mark ?? (tone === "ok" ? "✓" : tone ? "!" : "i")}</span>
      <div>{title && <b>{title}</b>}{children}</div>
    </motion.div>
  );
}

export type StepState = "done" | "active" | "todo" | "bad";

export function Tracker({ items }: { items: { s: StepState; title: string; sub?: ReactNode }[] }) {
  return (
    <ol className="tracker">
      {items.map((it, i) => (
        <motion.li key={it.title} data-s={it.s} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08, duration: 0.4, ease: EASE }}>
          <span className="tracker-dot">
            {it.s === "done" && <motion.svg viewBox="0 0 16 16" width="12"><motion.path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.2 + i * 0.08 }} /></motion.svg>}
            {it.s === "bad" && "!"}
          </span>
          <div><b>{it.title}</b>{it.sub && <small>{it.sub}</small>}</div>
        </motion.li>
      ))}
    </ol>
  );
}

export function TokenIcon({ kind }: { kind: "zec" | "usdc" | "perp" | "btc" | "eth" }) {
  const glyph = { zec: "ⓩ", usdc: "$", perp: "↗", btc: "₿", eth: "Ξ" }[kind];
  return <span className={`token-ic token-${kind}`} aria-hidden>{kind === "zec" ? <ZecGlyph /> : glyph}</span>;
}

function ZecGlyph() {
  return <svg viewBox="0 0 24 24" width="18" aria-hidden><path d="M7 6.5h10L7.5 17.5H17M12 3.5v3M12 17.5v3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function TokenRow({ icon, name, sub, amount, value, onClick }: { icon: ReactNode; name: ReactNode; sub?: ReactNode; amount?: ReactNode; value?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? motion.button : motion.div;
  return (
    <Tag className="token-row" onClick={onClick} whileHover={onClick ? { x: 2 } : undefined}>
      {icon}
      <div className="token-main"><b>{name}</b>{sub && <small>{sub}</small>}</div>
      <div className="token-amt">{amount && <b>{amount}</b>}{value && <small>{value}</small>}</div>
    </Tag>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><Star className="empty-star" />{children}</div>;
}

/** Inline line icons for actions and tabs. */
export function Icon({ name }: { name: "home" | "fund" | "trade" | "return" | "swap" | "copy" | "lock" | "check" }) {
  const p: Record<string, ReactNode> = {
    home: <><path d="M4 11l8-6.5 8 6.5" /><path d="M6 10v9h12v-9" /></>,
    fund: <><path d="M12 4v11" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19h14" /></>,
    trade: <><path d="M4 16l5-5 4 4 7-8" /><path d="M15 7h5v5" /></>,
    return: <><path d="M12 20V9" /><path d="M7.5 13.5L12 9l4.5 4.5" /><path d="M5 5h14" /></>,
    swap: <><path d="M7 4v14" /><path d="M4 15l3 3 3-3" /><path d="M17 20V6" /><path d="M14 9l3-3 3 3" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2.5" /><path d="M5 15V6a1 1 0 011-1h9" /></>,
    lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /></>,
    check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  };
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>;
}
