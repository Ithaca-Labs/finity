// Standalone recovery client. Talks only to the Hyperliquid API: works with the app server down.
// Usage: tsx recovery/recover.ts <testnet|mainnet> <address>                     (read-only)
//        TRADING_PRIVATE_KEY=0x.. tsx recovery/recover.ts <net> <address> --exit  (cancel all + reduce-only close all)
import { privateKeyToAccount } from "viem/accounts";
import { closePosition, createHl, getBalances, resolvePerp } from "../src/lib/hl/client";

const [net, addr, flag] = process.argv.slice(2);
if ((net !== "testnet" && net !== "mainnet") || !addr) throw new Error("usage: recover.ts <testnet|mainnet> <address> [--exit]");
const user = addr as `0x${string}`;
const exiting = flag === "--exit";
const key = process.env.TRADING_PRIVATE_KEY as `0x${string}` | undefined;
if (exiting && !key) throw new Error("--exit needs TRADING_PRIVATE_KEY in the environment");
const account = key ? privateKeyToAccount(key) : undefined;
if (account && account.address.toLowerCase() !== user.toLowerCase()) throw new Error(`Key controls ${account.address}, not ${user}`);
const hl = createHl(net, account);

console.log(`[${net}] balances for ${user}:`, JSON.stringify(await getBalances(hl, user), null, 1));
// Unit operations (deposits and returns) for this account: shows funds that are inside the bridge.
try {
  const r = await fetch(`${net === "mainnet" ? "https://api.hyperunit.xyz" : "https://api.hyperunit-testnet.xyz"}/operations/${user}`);
  const ops = ((await r.json()).operations ?? []) as any[];
  console.log(`Unit operations: ${ops.length}`);
  for (const o of ops) console.log(` ${o.sourceChain}->${o.destinationChain} ${o.sourceAmount ?? "?"} ${o.state} src=${o.sourceTxHash ?? "-"} dst=${o.destinationTxHash ?? "-"} to=${o.destinationAddress}`);
} catch (e) { console.log("Unit operations unavailable (this does not mean there are none):", e instanceof Error ? e.message : e); }
const open = await hl.info.openOrders({ user });
console.log("open orders:", open.length);
if (exiting) {
  for (const o of open) {
    const idx = (await hl.info.meta()).universe.findIndex((u) => u.name === o.coin);
    console.log("cancel", o.coin, o.oid, await hl.exchange!.cancel({ cancels: [{ a: idx, o: o.oid }] }));
  }
  const state = await hl.info.clearinghouseState({ user });
  for (const p of state.assetPositions.map((x) => x.position)) {
    console.log("closing", p.coin, p.szi, await closePosition(hl, user, await resolvePerp(hl, p.coin)));
  }
  console.log("after exit:", JSON.stringify(await getBalances(hl, user), null, 1));
}
