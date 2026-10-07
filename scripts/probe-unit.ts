// Phase 0: generate a Unit testnet deposit address for our account and verify guardian signatures.
import { verifyDepositAddressSignatures } from "../src/lib/bridge/guardians";
const dest = process.argv[2] ?? "0x1f20B96A9fde5218ED05A212B2d23093100785c0";
const res = await (await fetch(`https://api.hyperunit-testnet.xyz/gen/zcash/hyperliquid/zec/${dest}`)).json();
console.log("response:", res);
const proposal = { destinationAddress: dest, destinationChain: "hyperliquid", asset: "zec", address: res.address, sourceChain: "zcash", coinType: "zcash" };
console.log("testnet keys:", await verifyDepositAddressSignatures("testnet", res.signatures, proposal));
console.log("mainnet keys (must fail):", await verifyDepositAddressSignatures("mainnet", res.signatures, proposal));
console.log("tampered address (must fail):", await verifyDepositAddressSignatures("testnet", res.signatures, { ...proposal, address: "tmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" }));
