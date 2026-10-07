// Phase 3 live run on HL TESTNET:
//  A) XZEC -> USDC conversion plan (official token; book expected empty)
//  B) substitute spot round trip USDC -> PURR -> USDC (liquid testnet pair; NOT evidence for XZEC)
//  C) builder status, then a perp order whose response is lost AFTER it reached HL (injected),
//     showing the next order is blocked, reconciliation by cloid, and a reduce-only close.
import { privateKeyToAccount } from "viem/accounts";
import { createHl, getBalances, resolvePerp, formatPerpPrice, formatSize } from "../src/lib/hl/client";
import { OrderBlockedError, OrderLedger, notLandedAfter, persistentNonceManager, reconcileOrder, submitIoc } from "../src/lib/hl/orders";
import { availableSpot, executeConversion, planConversion, resolveSpot } from "../src/lib/hl/spot";
import { builderForOrder, builderStatus, needsClassTransfer, readAccountMode } from "../src/lib/hl/account";
import { UNIT_ZEC_TOKEN_ID } from "../src/lib/hl/xzec";

process.loadEnvFile(".env"); // key is stored as TESTNET_TRADING_PRIVATE_KEY in .env
const account = privateKeyToAccount(process.env.TESTNET_TRADING_PRIVATE_KEY as `0x${string}`);
const user = account.address;
const m = new Map<string, string>();
const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
const hl = createHl("testnet", account, { nonceManager: persistentNonceManager(kv) });
const ledger = new OrderLedger(kv, "testnet", user);
const log = (k: string, v: unknown) => console.log(`== ${k}:`, typeof v === "string" ? v : JSON.stringify(v, null, 1));

const mode = await readAccountMode(hl, user);
log("account", { user, mode, needsClassTransfer: needsClassTransfer(mode) });
const start = await getBalances(hl, user);
log("start balances", { perps: start.perpsAccountValue, spot: start.spot.map((b) => [b.coin, b.total, b.hold]) });

// A) official XZEC
const xzec = await resolveSpot(hl, UNIT_ZEC_TOKEN_ID.testnet);
log("XZEC market", xzec);
log("XZEC -> USDC plan (0.1)", await planConversion(hl, xzec, "to_usdc", 0.1, 0.02));

// B) substitute pair, resolved by token id from live metadata
const meta = await hl.info.spotMeta();
const purrTok = meta.tokens.find((t) => t.name === "PURR")!;
const purr = await resolveSpot(hl, purrTok.tokenId);
const mid = Number((await hl.info.allMids())[purr.pair]);
const buyPlan = await planConversion(hl, purr, "to_unit", 15 / mid, 0.02); // ~15 USDC: szDecimals 0 floors the size, must stay >= 10 USDC
log("substitute buy plan", buyPlan);
if (buyPlan.ok) {
  const buy = await executeConversion(hl, ledger, "testnet", user, buyPlan.plan);
  log("substitute buy", buy);
  const spot = (await hl.info.spotClearinghouseState({ user })).balances;
  const have = availableSpot(spot as any, purr.base.index);
  log("PURR available after buy (re-read, not assumed)", have);
  const sellPlan = await planConversion(hl, purr, "to_usdc", Math.min(have, Number(buy.filledSz ?? 0)), 0.02);
  log("substitute sell plan", sellPlan);
  if (sellPlan.ok) log("substitute sell", await executeConversion(hl, ledger, "testnet", user, sellPlan.plan));
}

// C) builder + lost-response reconciliation on a BTC perp
const builder = await builderStatus(hl, user, user); // self as builder, as in Phase 1b
log("builder status", builder);
const btc = await resolvePerp(hl, "BTC");
const btcMid = Number((await hl.info.allMids())["BTC"]);
const size = formatSize(12 / btcMid + 10 ** -btc.szDecimals, btc.szDecimals);
const lossy = { order: async (p: any) => { await hl.exchange!.order(p); throw new Error("injected: response lost after submission"); } };
const open = await submitIoc(lossy, ledger, "testnet", user, {
  label: "BTC perp open", asset: btc.assetIndex, isBuy: true, size,
  px: formatPerpPrice(btcMid * 1.03, btc.szDecimals), builder: builderForOrder(builder),
});
log("open (response lost)", open);
try { await submitIoc(hl.exchange!, ledger, "testnet", user, { label: "retry", asset: btc.assetIndex, isBuy: true, size, px: "1" }); log("retry", "NOT BLOCKED (bug)"); }
catch (e) { log("retry", e instanceof OrderBlockedError ? `blocked: ${e.message}` : String(e)); }
let rec = await reconcileOrder(hl.info, ledger, user, open.cloid);
log("reconcile immediately", [rec.state, rec.error]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
while (rec.state === "unknown" && Date.now() < notLandedAfter(rec) + 5_000) {
  await sleep(3_000);
  rec = await reconcileOrder(hl.info, ledger, user, open.cloid);
  log(`reconcile +${Math.round((Date.now() - Date.parse(rec.createdAt)) / 1000)}s`, [rec.state, rec.filledSz, rec.evidence]);
}
log("reconciled", rec);
const pos = (await getBalances(hl, user)).positions.find((p) => p.coin === "BTC");
log("BTC position after reconcile", pos?.szi ?? "0");
if (pos && Number(pos.szi) !== 0) {
  const close = await submitIoc(hl.exchange!, ledger, "testnet", user, {
    label: "BTC reduce-only close", asset: btc.assetIndex, isBuy: Number(pos.szi) < 0, size: String(Math.abs(Number(pos.szi))),
    px: formatPerpPrice(btcMid * (Number(pos.szi) < 0 ? 1.03 : 0.97), btc.szDecimals), reduceOnly: true,
  });
  log("close", close);
}
await sleep(5_000); // info-API lag
const fills = await hl.info.userFills({ user });
log("fills for this run", fills.filter((f) => ledger.list().some((r) => r.cloid === f.cloid)).map((f) => ({ coin: f.coin, dir: f.dir, sz: f.sz, px: f.px, fee: f.fee, builderFee: (f as any).builderFee, cloid: f.cloid })));
const end = await getBalances(hl, user);
log("end balances", { perps: end.perpsAccountValue, positions: end.positions.length, spot: end.spot.map((b) => [b.coin, b.total, b.hold]) });
log("ledger", ledger.list().map((r) => [r.label, r.state, r.size, r.filledSz, r.evidence]));
