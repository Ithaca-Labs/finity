// Retry only the HL USDC withdrawal (route C) with a given amount, and print what the ledger says.
process.loadEnvFile(".env.local");
import { privateKeyToAccount } from "viem/accounts";
import { createHl } from "../src/lib/hl/client";
const account = privateKeyToAccount(process.env.TESTNET_TRADING_PRIVATE_KEY as `0x${string}`);
const hl = createHl("testnet", account);
const amount = process.argv[2] ?? "10";
try { console.log("withdraw3", amount, await hl.exchange!.withdraw3({ destination: account.address, amount })); }
catch (e) { console.log("withdraw3", amount, "FAILED:", (e as Error).message); }
await new Promise((r) => setTimeout(r, 3000));
const ups = await hl.info.userNonFundingLedgerUpdates({ user: account.address, startTime: Date.now() - 5 * 60_000 });
console.log("withdraw ledger entries:", ups.filter((u: any) => u.delta.type === "withdraw").map((u: any) => u.delta));
