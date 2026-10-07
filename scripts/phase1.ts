// Phase 1 live run on HL TESTNET: balances -> spot->perps -> small BTC open -> reduce-only close.
import { privateKeyToAccount } from "viem/accounts";
import { closePosition, createHl, getBalances, placeIoc, resolvePerp } from "../src/lib/hl/client";

process.loadEnvFile(".env.local");
const account = privateKeyToAccount(process.env.TESTNET_TRADING_PRIVATE_KEY as `0x${string}`);
const user = account.address;
const hl = createHl("testnet", account);
const show = async (label: string) => console.log(label, JSON.stringify(await getBalances(hl, user), null, 1));

console.log("account", user, "abstraction:", await hl.info.userAbstraction({ user }));
await show("== start");

const bal = await getBalances(hl, user);
if (Number(bal.perpsAccountValue) < 100) {
  const r = await hl.exchange!.usdClassTransfer({ amount: "400", toPerp: true });
  console.log("usdClassTransfer:", r);
  await show("== after spot->perps");
}

const btc = await resolvePerp(hl, "BTC");
const mid = Number((await hl.info.allMids())["BTC"]);
const size = 25 / mid; // ~$25 notional (HL minimum order value is $10)
console.log("BTC", btc, "mid", mid, "size", size);

const open = await placeIoc(hl, btc, { isBuy: true, size, slippage: 0.05 });
console.log("open:", open);
await show("== after open");

const close = await closePosition(hl, user, btc);
console.log("close:", close);
await show("== after close");

const fills = await hl.info.userFills({ user });
console.log("fills:", fills.slice(0, 4).map((f) => ({ coin: f.coin, dir: f.dir, sz: f.sz, px: f.px, fee: f.fee, cloid: f.cloid })));
