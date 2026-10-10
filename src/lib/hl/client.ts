import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Network } from "../bridge/guardians";

export function createHl(network: Network, wallet?: PrivateKeyAccount, opts?: { nonceManager?: (address: string) => number }) {
  const transport = new HttpTransport({ isTestnet: network === "testnet" });
  const info = new InfoClient({ transport });
  const exchange = wallet ? new ExchangeClient({ transport, wallet, nonceManager: opts?.nonceManager }) : undefined;
  return { info, exchange, network };
}
export type Hl = ReturnType<typeof createHl>;

export async function getBalances(hl: Hl, user: `0x${string}`) {
  const [perps, spot] = await Promise.all([hl.info.clearinghouseState({ user }), hl.info.spotClearinghouseState({ user })]);
  return {
    perpsAccountValue: perps.marginSummary.accountValue,
    withdrawable: perps.withdrawable,
    positions: perps.assetPositions.map((p) => p.position),
    spot: spot.balances,
  };
}

export interface PerpMarket { name: string; assetIndex: number; szDecimals: number; maxLeverage: number }

export async function resolvePerp(hl: Hl, coin: string): Promise<PerpMarket> {
  const meta = await hl.info.meta();
  const assetIndex = meta.universe.findIndex((u) => u.name === coin);
  const u = meta.universe[assetIndex];
  if (!u) throw new Error(`Perp ${coin} not found on ${hl.network}`);
  if (u.isDelisted) throw new Error(`Perp ${coin} is delisted on ${hl.network}`);
  return { name: coin, assetIndex, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage };
}

/** HL price rule: at most 5 significant figures and at most (6 - szDecimals) decimals for perps. */
export function formatPerpPrice(px: number, szDecimals: number): string {
  const maxDecimals = 6 - szDecimals;
  const fiveSig = Number(px.toPrecision(5));
  return fiveSig.toFixed(Math.max(0, maxDecimals)).replace(/\.?0+$/, "") || "0";
}

export function formatSize(sz: number, szDecimals: number): string {
  const f = 10 ** szDecimals;
  // Epsilon guards float error (0.0003 * 1e5 = 29.999...) so exact sizes don't floor down a tick.
  return (Math.floor(sz * f + 1e-9) / f).toFixed(szDecimals);
}

/** 16-byte client order id as 0x + 32 hex, used to reconcile unknown outcomes. */
export function newCloid(): `0x${string}` {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export type OrderOutcome =
  | { kind: "filled"; cloid: string; totalSz: string; avgPx: string; oid: number }
  | { kind: "resting"; cloid: string; oid: number }
  | { kind: "rejected"; cloid: string; error: string }
  | { kind: "unknown"; cloid: string; error: string };

/** Price-bounded IOC "market" order. Never retried automatically: on unknown, reconcile by cloid. */
export async function placeIoc(
  hl: Hl, market: PerpMarket, opts: { isBuy: boolean; size: number; slippage: number; reduceOnly?: boolean },
): Promise<OrderOutcome> {
  if (!hl.exchange) throw new Error("No signer");
  const mids = await hl.info.allMids();
  const mid = Number(mids[market.name]);
  if (!mid) throw new Error(`No mid price for ${market.name}`);
  const bound = mid * (opts.isBuy ? 1 + opts.slippage : 1 - opts.slippage);
  const cloid = newCloid();
  try {
    const res = await hl.exchange.order({
      orders: [{
        a: market.assetIndex, b: opts.isBuy, p: formatPerpPrice(bound, market.szDecimals),
        s: formatSize(opts.size, market.szDecimals), r: opts.reduceOnly ?? false,
        t: { limit: { tif: "Ioc" } }, c: cloid,
      }],
      grouping: "na",
    });
    const st: any = res.response.data.statuses[0];
    if (st.filled) return { kind: "filled", cloid, totalSz: st.filled.totalSz, avgPx: st.filled.avgPx, oid: st.filled.oid };
    if (st.resting) return { kind: "resting", cloid, oid: st.resting.oid };
    return { kind: "rejected", cloid, error: st.error ?? JSON.stringify(st) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A transport error after submission may still have landed: caller must reconcile by cloid.
    return e instanceof ApiRequestError ? { kind: "rejected", cloid, error: msg } : { kind: "unknown", cloid, error: msg };
  }
}

/** Reconcile an order whose outcome is unknown by looking it up via client order id. */
export async function reconcileCloid(hl: Hl, user: `0x${string}`, cloid: `0x${string}`) {
  return hl.info.orderStatus({ user, oid: cloid });
}

/** Reduce-only close of the full current position in a coin. */
export async function closePosition(hl: Hl, user: `0x${string}`, market: PerpMarket, slippage = 0.05) {
  const state = await hl.info.clearinghouseState({ user });
  const pos = state.assetPositions.map((p) => p.position).find((p) => p.coin === market.name);
  const szi = pos ? Number(pos.szi) : 0;
  if (szi === 0) return null;
  return placeIoc(hl, market, { isBuy: szi < 0, size: Math.abs(szi), slippage, reduceOnly: true });
}
