// Phase 4: generate a Unit withdrawal (HL -> Zcash) address and find which guardian payload it signs.
// Read-only: no funds are sent. Usage: tsx scripts/probe-withdraw.ts <mainnet|testnet> <zcash-transparent-address>
import { verifyDepositAddressSignatures, type Network } from "../src/lib/bridge/guardians";
const net = (process.argv[2] ?? "mainnet") as Network;
const dest = process.argv[3] ?? "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs"; // docs example; research fixture only, never fund
const api = net === "mainnet" ? "https://api.hyperunit.xyz" : "https://api.hyperunit-testnet.xyz";
const r = await fetch(`${api}/gen/hyperliquid/zcash/zec/${dest}`);
const res = await r.json();
console.log(r.status, res);
if (!res.signatures) process.exit(0);
for (const coinType of ["zcash", "ethereum", "hyperliquid", undefined]) {
  const p = { destinationAddress: dest, destinationChain: "zcash", asset: "zec", address: res.address, sourceChain: "hyperliquid", coinType };
  console.log(coinType, await verifyDepositAddressSignatures(net, res.signatures, p));
}
