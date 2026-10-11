"use client";
// Demo balances from the hardcoded deposit flow: XZEC credited by deposits, USDC from swapping it.
// They live for this browser session only and never touch Hyperliquid.
import { useSyncExternalStore } from "react";

const EVENT = "finity-demo-balance";
const store = () => { try { return window.sessionStorage; } catch { return undefined; } };
const read = (key: string) => Number(store()?.getItem(key) ?? 0) || 0;
const write = (key: string, v: number) => { try { store()?.setItem(key, String(Math.max(0, Number(v.toFixed(8))))); } catch {} window.dispatchEvent(new Event(EVENT)); };
const subscribe = (cb: () => void) => { window.addEventListener(EVENT, cb); return () => window.removeEventListener(EVENT, cb); };

const ZEC = "finity-demo-xzec", USDC = "finity-demo-usdc";

export const readDemoZec = () => read(ZEC);
export const creditDemoZec = (amount: number) => write(ZEC, read(ZEC) + amount);
export const useDemoZec = () => useSyncExternalStore(subscribe, readDemoZec, () => 0);
export const useDemoUsdc = () => useSyncExternalStore(subscribe, () => read(USDC), () => 0);

/** Swap demo XZEC for demo USDC at the given price. */
export function swapDemoZec(amount: number, px: number) {
  if (amount > read(ZEC) + 1e-9) throw new Error(`Only ${read(ZEC)} demo XZEC available`);
  write(ZEC, read(ZEC) - amount);
  write(USDC, read(USDC) + amount * px);
}
