"use client";
// Browser side of the central wallet: reads go straight to Hyperliquid, signed actions go through /api/hl.
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import type { Hl } from "@/lib/hl/client";

async function call(method: string, params: unknown) {
  const r = await fetch("/api/hl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, params }) });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
  return body.result;
}

export async function centralAddress(): Promise<`0x${string}`> {
  const r = await fetch("/api/hl");
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? "Central wallet unavailable");
  return body.address;
}

export function centralHl(): Hl {
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet: true }) });
  const exchange = new Proxy({}, { get: (_, method: string) => (params: unknown) => call(method, params) });
  return { info, exchange, network: "testnet" } as unknown as Hl;
}
