"use client";
// Demo XZEC credited by the hardcoded deposit flow. Lives for this browser session only.
import { useSyncExternalStore } from "react";

const KEY = "finity-demo-xzec";
const EVENT = "finity-demo-xzec";
const store = () => { try { return window.sessionStorage; } catch { return undefined; } };

export function readDemoZec(): number { return Number(store()?.getItem(KEY) ?? 0) || 0; }

export function creditDemoZec(amount: number) {
  try { store()?.setItem(KEY, String(readDemoZec() + amount)); } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function useDemoZec(): number {
  return useSyncExternalStore(
    (cb) => { window.addEventListener(EVENT, cb); return () => window.removeEventListener(EVENT, cb); },
    readDemoZec, () => 0,
  );
}
