// Reads the official Unit ZEC token balance by token ID, never by name (UZEC/BZEC lookalikes exist).
import type { Network } from "../bridge/guardians";

export const UNIT_ZEC_TOKEN_ID: Record<Network, string> = {
  testnet: "0xc8e8047efa1400eb0b7b9bbee16b759d", // XZEC, Unit testnet token metadata
  mainnet: "0x1c994ad3381d31c86c8c2d74ed89a365", // UZEC, live-observed 4 Oct
};
const INFO: Record<Network, string> = {
  testnet: "https://api.hyperliquid-testnet.xyz/info",
  mainnet: "https://api.hyperliquid.xyz/info",
};

const post = async (network: Network, body: unknown) => {
  const r = await fetch(INFO[network], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HL info ${r.status}`);
  return r.json();
};

export async function unitZecBalance(network: Network, user: string): Promise<{ token: string; index: number; total: number }> {
  const meta = await post(network, { type: "spotMeta" });
  const t = meta.tokens.find((x: any) => x.tokenId === UNIT_ZEC_TOKEN_ID[network]);
  if (!t) throw new Error(`Official Unit ZEC token not found on ${network}`);
  const st = await post(network, { type: "spotClearinghouseState", user });
  const b = st.balances.find((x: any) => x.token === t.index);
  return { token: t.name, index: t.index, total: b ? Number(b.total) : 0 };
}
