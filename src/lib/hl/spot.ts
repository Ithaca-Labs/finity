// Unit token <-> USDC conversion as separate, price-bounded IOC spot orders.
// Markets are resolved by token ID (never by name), and precision comes from live spotMeta.
import type { Network } from "../bridge/guardians";
import type { Hl } from "./client";
import { formatSize } from "./client";
import { submitIoc, type OrderLedger, type OrderRecord } from "./orders";

export interface SpotMarket {
  pair: string; // e.g. "@272": the coin name for l2Book / allMids
  marketIndex: number;
  asset: number; // order selector: 10000 + marketIndex
  base: { name: string; index: number; tokenId: string; szDecimals: number };
  tokenSelector: string; // spotSend selector "NAME:0xtokenId", not the pair name
}

export function resolveSpotFromMeta(meta: any, tokenId: string): SpotMarket {
  const t = meta.tokens.find((x: any) => x.tokenId === tokenId);
  if (!t) throw new Error(`Token ${tokenId} not found in spotMeta`);
  const usdc = meta.tokens.find((x: any) => x.name === "USDC");
  const u = meta.universe.find((m: any) => m.tokens[0] === t.index && m.tokens[1] === usdc?.index);
  if (!u) throw new Error(`No ${t.name}/USDC spot market for token ${tokenId}`);
  return {
    pair: u.name, marketIndex: u.index, asset: 10000 + u.index,
    base: { name: t.name, index: t.index, tokenId: t.tokenId, szDecimals: t.szDecimals },
    tokenSelector: `${t.name}:${t.tokenId}`,
  };
}

export async function resolveSpot(hl: Hl, tokenId: string) {
  return resolveSpotFromMeta(await hl.info.spotMeta(), tokenId);
}

/** HL spot price rule: at most 5 significant figures and at most (8 - szDecimals) decimals. */
export function formatSpotPrice(px: number, szDecimals: number): string {
  const fiveSig = Number(px.toPrecision(5));
  return fiveSig.toFixed(Math.max(0, 8 - szDecimals)).replace(/\.?0+$/, "") || "0";
}

type Level = { px: string; sz: string };
export type Quote =
  | { ok: false; reason: string }
  | { ok: true; bestPx: number; boundPx: string; estFillSz: number; estAvgPx: number; estQuote: number; partialExpected: boolean };

/** Walk the visible book up to the slippage bound. A quote is an estimate; the fill is what counts. */
export function quoteIoc(book: { levels: [Level[], Level[]] }, isBuy: boolean, size: number, slippage: number, szDecimals: number): Quote {
  if (!(size > 0)) return { ok: false, reason: "Size must be positive" };
  const side = isBuy ? book.levels[1] : book.levels[0]; // buy lifts asks, sell hits bids
  if (!side.length) return { ok: false, reason: `No ${isBuy ? "asks" : "bids"} in the order book: no liquidity to convert against` };
  const bestPx = Number(side[0].px);
  const bound = bestPx * (isBuy ? 1 + slippage : 1 - slippage);
  let left = size, got = 0, quote = 0;
  for (const l of side) {
    const px = Number(l.px);
    if (isBuy ? px > bound : px < bound) break;
    const take = Math.min(left, Number(l.sz));
    got += take; quote += take * px; left -= take;
    if (left <= 0) break;
  }
  return {
    ok: true, bestPx, boundPx: formatSpotPrice(bound, szDecimals),
    estFillSz: got, estAvgPx: got ? quote / got : 0, estQuote: quote, partialExpected: got < size,
  };
}

/** HL rejects orders below this value ("Order must have minimum value of 10 USDC"), observed live 7 Oct. */
export const MIN_ORDER_USDC = 10;

export interface ConversionPlan { market: SpotMarket; direction: "to_usdc" | "to_unit"; size: string; quote: Extract<Quote, { ok: true }> }

/** Build a reviewable plan; nothing is signed here. Size is in base-token units, floored to metadata precision. */
export async function planConversion(hl: Hl, market: SpotMarket, direction: ConversionPlan["direction"], sizeBase: number, slippage: number):
  Promise<{ ok: true; plan: ConversionPlan } | { ok: false; reason: string }> {
  const size = formatSize(sizeBase, market.base.szDecimals);
  if (Number(size) <= 0) return { ok: false, reason: `Size rounds to 0 at ${market.base.szDecimals} decimals` };
  const book = await hl.info.l2Book({ coin: market.pair });
  if (!book) return { ok: false, reason: `No book for ${market.pair}` };
  const q = quoteIoc(book as any, direction === "to_unit", Number(size), slippage, market.base.szDecimals);
  if (!q.ok) return q;
  const notional = Number(size) * q.bestPx;
  if (notional < MIN_ORDER_USDC) return { ok: false, reason: `Order value ~${notional.toFixed(2)} USDC is below Hyperliquid's ${MIN_ORDER_USDC} USDC minimum` };
  return { ok: true, plan: { market, direction, size, quote: q } };
}

export async function executeConversion(hl: Hl, ledger: OrderLedger, network: Network, account: string, plan: ConversionPlan): Promise<OrderRecord> {
  if (!hl.exchange) throw new Error("No signer");
  const name = plan.market.base.name;
  return submitIoc(hl.exchange, ledger, network, account, {
    label: plan.direction === "to_usdc" ? `${name} -> USDC` : `USDC -> ${name}`,
    asset: plan.market.asset, isBuy: plan.direction === "to_unit", size: plan.size, px: plan.quote.boundPx,
  });
}

/** Available (total - hold) spot balance for a token index; what a sell may actually use. */
export function availableSpot(balances: { token: number; total: string; hold: string }[], tokenIndex: number) {
  const b = balances.find((x) => x.token === tokenIndex);
  return b ? Number(b.total) - Number(b.hold) : 0;
}
