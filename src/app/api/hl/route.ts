// finity's central Hyperliquid testnet wallet. The key stays on the server; the browser asks this route to sign.
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

// Only the actions the wallet UI uses. Withdrawals and agent/key changes are never signed here.
const ALLOWED = new Set(["order", "cancel", "updateLeverage", "usdClassTransfer"]);

function central() {
  const key = process.env.TESTNET_TRADING_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("TESTNET_TRADING_PRIVATE_KEY is not set");
  const wallet = privateKeyToAccount(key);
  return { wallet, exchange: new ExchangeClient({ transport: new HttpTransport({ isTestnet: true }), wallet }) };
}

export async function GET() {
  try { return Response.json({ address: central().wallet.address, network: "testnet" }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}

export async function POST(request: Request) {
  const { method, params } = (await request.json()) as { method?: string; params?: unknown };
  if (!method || !ALLOWED.has(method)) return Response.json({ error: `Action "${method}" is not allowed` }, { status: 403 });
  try {
    const ex = central().exchange as unknown as Record<string, (p: unknown) => Promise<unknown>>;
    return Response.json({ result: await ex[method](params) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
