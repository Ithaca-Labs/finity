// Phase 1b (testnet): recovery --exit on a live position, then builder-fee approval + attributed fill.
import { privateKeyToAccount } from "viem/accounts";
import { execFileSync } from "node:child_process";
import { closePosition, createHl, getBalances, newCloid, placeIoc, resolvePerp } from "../src/lib/hl/client";

process.loadEnvFile(".env.local");
const key = process.env.TESTNET_TRADING_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(key);
const user = account.address;
const hl = createHl("testnet", account);
const btc = await resolvePerp(hl, "BTC");
const size = 25 / Number((await hl.info.allMids())["BTC"]);

// A) leave a position open, then recover it with the standalone CLI (separate process, key via env only)
console.log("open:", await placeIoc(hl, btc, { isBuy: true, size, slippage: 0.05 }));
console.log("positions before exit:", (await getBalances(hl, user)).positions.map((p) => [p.coin, p.szi]));
console.log(execFileSync("npx", ["tsx", "recovery/recover.ts", "testnet", user, "--exit"], { env: { ...process.env, TRADING_PRIVATE_KEY: key }, encoding: "utf8", shell: true }).split("\n").filter((l) => /closing|open orders|perpsAccountValue/.test(l)).join("\n"));
console.log("positions after exit:", (await getBalances(hl, user)).positions.length);

// B) builder fee: self as builder (needs >=100 USDC perps value), 0.05% = f:50 (tenths of a bp)
console.log("approveBuilderFee:", await hl.exchange!.approveBuilderFee({ builder: user, maxFeeRate: "0.05%" }));
const mid = Number((await hl.info.allMids())["BTC"]);
const cloid = newCloid();
const o: any = await hl.exchange!.order({
  orders: [{ a: btc.assetIndex, b: true, p: String(Math.round(mid * 1.05)), s: "0.00029", r: false, t: { limit: { tif: "Ioc" } }, c: cloid }],
  grouping: "na", builder: { b: user, f: 50 },
});
console.log("builder order:", JSON.stringify(o.response.data.statuses));
console.log("close:", await closePosition(hl, user, btc));
const fills = await hl.info.userFills({ user });
console.log("recent fills:", fills.slice(0, 4).map((f) => ({ dir: f.dir, sz: f.sz, px: f.px, fee: f.fee, builderFee: (f as any).builderFee, cloid: f.cloid })));
