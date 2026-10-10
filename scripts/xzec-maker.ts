// TESTNET liquidity for XZEC/USDC: the testnet book is otherwise empty, so ZEC <-> USDC conversion has no
// counterparty. Quotes a bid (from maker USDC) and an ask (from maker XZEC) around the MAINNET ZEC price.
// Usage: npx tsx scripts/xzec-maker.ts [--once]   (keys: TESTNET_MAKER_PRIVATE_KEY in .env)
import { privateKeyToAccount } from "viem/accounts";
import { createHl, formatSize } from "../src/lib/hl/client";
import { formatSpotPrice, resolveSpot, availableSpot } from "../src/lib/hl/spot";
import { UNIT_ZEC_TOKEN_ID } from "../src/lib/hl/xzec";

process.loadEnvFile(".env");
const SPREAD = 0.005; // each side 0.5% from the mainnet mid
const REFRESH_MS = 60_000;
const account = privateKeyToAccount(process.env.TESTNET_MAKER_PRIVATE_KEY as `0x${string}`);
const hl = createHl("testnet", account);
const mainnet = createHl("mainnet");
const mkt = await resolveSpot(hl, UNIT_ZEC_TOKEN_ID.testnet);

async function quote() {
  const mid = Number((await mainnet.info.allMids()).ZEC);
  if (!mid) throw new Error("No mainnet ZEC mid");
  const open = (await hl.info.openOrders({ user: account.address })).filter((o) => o.coin === mkt.pair);
  if (open.length) await hl.exchange!.cancel({ cancels: open.map((o) => ({ a: mkt.asset, o: o.oid })) });

  const bal = (await hl.info.spotClearinghouseState({ user: account.address })).balances as any[];
  const usdc = availableSpot(bal, 0), xzec = availableSpot(bal, mkt.base.index);
  const orders = [];
  const bidPx = mid * (1 - SPREAD), askPx = mid * (1 + SPREAD);
  const bidSz = formatSize((usdc * 0.98) / bidPx, mkt.base.szDecimals);
  const askSz = formatSize(xzec, mkt.base.szDecimals);
  if (Number(bidSz) * bidPx >= 10) orders.push({ a: mkt.asset, b: true, p: formatSpotPrice(bidPx, mkt.base.szDecimals), s: bidSz, r: false, t: { limit: { tif: "Gtc" as const } } });
  if (Number(askSz) * askPx >= 10) orders.push({ a: mkt.asset, b: false, p: formatSpotPrice(askPx, mkt.base.szDecimals), s: askSz, r: false, t: { limit: { tif: "Gtc" as const } } });
  const res = orders.length ? await hl.exchange!.order({ orders, grouping: "na" }) : null;
  console.log(new Date().toISOString(), `${mkt.pair} mainnet mid ${mid}`, `usdc ${usdc} xzec ${xzec}`,
    orders.map((o) => `${o.b ? "bid" : "ask"} ${o.s}@${o.p}`).join(", ") || "nothing to quote",
    res ? JSON.stringify(res.response.data.statuses) : "");
}

await quote();
if (!process.argv.includes("--once")) setInterval(() => quote().catch((e) => console.error("quote failed:", e.message)), REFRESH_MS);
