// Reconciles the testnet trading account from HL's own records (read-only):
// received - transfers out - fees - perp PnL - spot trade flows = current USDC (spot + perps).
process.loadEnvFile(".env.local");
import { createHl } from "../src/lib/hl/client";
const me = process.env.TESTNET_TRADING_ADDRESS as `0x${string}`;
const recv = process.env.TESTNET_RECEIVER_ADDRESS as `0x${string}`;
const hl = createHl("testnet");
const usdcOf = async (u: `0x${string}`) => {
  const [p, s] = await Promise.all([hl.info.clearinghouseState({ user: u }), hl.info.spotClearinghouseState({ user: u })]);
  return { perps: Number(p.marginSummary.accountValue), spotUsdc: Number(s.balances.find((b) => b.coin === "USDC")?.total ?? 0), other: s.balances.filter((b) => b.coin !== "USDC") };
};
const mine = await usdcOf(me), theirs = await usdcOf(recv);
const fills = await hl.info.userFills({ user: me });
const isSpot = (c: string) => c.includes("/") || c.startsWith("@");
let perpPnl = 0, perpFee = 0, builderFee = 0, spotFlow = 0, spotFeeUsdc = 0;
const spotTokens: Record<string, number> = {};
for (const f of fills) {
  if (!isSpot(f.coin)) { perpPnl += Number(f.closedPnl); perpFee += Number(f.fee); builderFee += Number((f as any).builderFee ?? 0); continue; }
  const sign = f.dir === "Buy" ? -1 : 1;
  spotFlow += sign * Number(f.sz) * Number(f.px);
  const base = f.coin.split("/")[0];
  spotTokens[base] = (spotTokens[base] ?? 0) - sign * Number(f.sz);
  if ((f as any).feeToken === "USDC") spotFeeUsdc += Number(f.fee); else spotTokens[base] -= Number(f.fee);
}
let received = 0, receivedFee = 0, sent = 0, sentFee = 0;
for (const u of await hl.info.userNonFundingLedgerUpdates({ user: me, startTime: 0 })) {
  const d: any = u.delta; const iAmSender = String(d.user).toLowerCase() === me.toLowerCase();
  if ((d.type === "send" || d.type === "spotTransfer") && d.token === "USDC") {
    if (iAmSender) { sent += Number(d.amount); sentFee += Number(d.fee); } else { received += Number(d.amount); receivedFee += Number(d.fee); }
  }
}
const expected = received - sent - sentFee + (perpPnl - perpFee - builderFee) + (spotFlow - spotFeeUsdc);
const actual = mine.perps + mine.spotUsdc;
console.log({ received, receivedFeePaidBySender: receivedFee, sent, sentFee, perp: { pnl: perpPnl, fee: perpFee, builderFee }, spot: { usdcFlow: spotFlow, usdcFee: spotFeeUsdc, netTokens: spotTokens } });
console.log("trading account  USDC: spot", mine.spotUsdc, "+ perps", mine.perps, "=", actual.toFixed(6), "| other tokens:", mine.other.map((o) => `${o.coin} ${o.total}`));
console.log("receiver account USDC:", theirs.spotUsdc);
console.log("expected:", expected.toFixed(6), "| unexplained:", (actual - expected).toFixed(6));
