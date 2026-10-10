// Server-side signer for the dedicated TESTNET trading key, so the /trade page can open/close
// perps without the key ever reaching the browser. Testnet only; disabled in production builds
// unless ENABLE_SERVER_SIGNER=1 is set explicitly.
import { privateKeyToAccount } from "viem/accounts";
import { closePosition, createHl, placeIoc, resolvePerp } from "@/lib/hl/client";

const COINS = ["BTC", "ETH"];
const MAX_NOTIONAL_USD = 500;

function signer() {
  const key = process.env.TESTNET_TRADING_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_SERVER_SIGNER !== "1") return null;
  return privateKeyToAccount(key as `0x${string}`);
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const account = signer();
  return account ? Response.json({ address: account.address, network: "testnet" }) : fail("Server signer not configured", 404);
}

export async function POST(req: Request) {
  const account = signer();
  if (!account) return fail("Server signer not configured", 404);
  const body = await req.json().catch(() => null);
  if (!body || !COINS.includes(body.coin)) return fail(`coin must be one of ${COINS.join(", ")}`);

  const hl = createHl("testnet", account);
  try {
    const market = await resolvePerp(hl, body.coin);

    if (body.action === "close") {
      const outcome = await closePosition(hl, account.address, market, 0.05);
      return Response.json({ outcome: outcome ?? { kind: "no_position" } });
    }

    if (body.action === "open") {
      const usd = Number(body.usd), leverage = Math.floor(Number(body.leverage)), slippage = Number(body.slippage);
      if (!(usd >= 10 && usd <= MAX_NOTIONAL_USD)) return fail(`Notional must be between 10 and ${MAX_NOTIONAL_USD} USDC`);
      if (!(leverage >= 1 && leverage <= market.maxLeverage)) return fail(`Leverage must be 1-${market.maxLeverage}x`);
      if (!(slippage > 0 && slippage <= 0.05)) return fail("Slippage must be in (0, 0.05]");
      if (body.side !== "long" && body.side !== "short") return fail("side must be long or short");

      const mid = Number((await hl.info.allMids())[market.name]);
      await hl.exchange!.updateLeverage({ asset: market.assetIndex, isCross: true, leverage });
      const outcome = await placeIoc(hl, market, { isBuy: body.side === "long", size: usd / mid, slippage });
      return Response.json({ outcome });
    }

    return fail("action must be open or close");
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
}
