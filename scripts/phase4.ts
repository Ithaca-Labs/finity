// Phase 4 live run on HL TESTNET. Everything here is real except where labelled.
//  A. Unit withdrawal address generation + guardian verification (testnet: expected to fail; mainnet: read-only)
//  B. Real spotSend through the transfer journal, with the RESPONSE LOST on purpose, local storage wiped,
//     and the transfer recovered from Hyperliquid's own ledger by nonce.
//  C. Alternate recovery route: HL USDC withdrawal to Arbitrum Sepolia (initiation only; see phase4-check.ts).
import { appendFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createHl, getBalances } from "../src/lib/hl/client";
import { reconcileTransfer, realSender, submitSpotSend, TransferLedger } from "../src/lib/hl/transfer";
import { generateWithdrawal } from "../src/lib/bridge/withdraw";

process.loadEnvFile(".env.local");
const account = privateKeyToAccount(process.env.TESTNET_TRADING_PRIVATE_KEY as `0x${string}`);
const me = account.address;
const hl = createHl("testnet", account);

// ---- A. withdrawal address generation
console.log("\n== A. Unit withdrawal address generation");
for (const [net, dest] of [["testnet", "tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy"], ["mainnet", "t1SRsjhoLEGvugRGdBBHmxqxCs5ohKtjuRo"]] as const) {
  try {
    const w = await generateWithdrawal(net, dest, me);
    console.log(net, "OK  protocol address", w.protocolAddress, "guardians", w.verification.verifiedCount, "/3");
  } catch (e) { console.log(net, "FAIL", (e as Error).message); }
}

// ---- B. real transfer, lost response, wiped storage, recovery from the HL ledger
console.log("\n== B. transfer journal against real HL");
if (!process.env.TESTNET_RECEIVER_ADDRESS) {
  const k = generatePrivateKey();
  const addr = privateKeyToAccount(k).address;
  appendFileSync(".env.local", `\n# second TESTNET-ONLY account used as a transfer receiver\nTESTNET_RECEIVER_PRIVATE_KEY=${k}\nTESTNET_RECEIVER_ADDRESS=${addr}\n`);
  process.env.TESTNET_RECEIVER_ADDRESS = addr;
}
const receiver = process.env.TESTNET_RECEIVER_ADDRESS as `0x${string}`;
const mem = new Map<string, string>();
const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
const ledger = new TransferLedger(kv, "testnet", me);
const usdcTok = (await hl.info.spotMeta()).tokens.find((t) => t.name === "USDC")!;
const USDC = `USDC:${usdcTok.tokenId}`; // resolved from live metadata: the id differs between testnet and mainnet
const real = realSender("testnet", account);

const spotBefore = await getBalances(hl, me);
const usdc = (b: typeof spotBefore) => Number(b.spot.find((x) => x.coin === "USDC")?.total ?? 0);
const recvBefore = Number((await getBalances(hl, receiver as `0x${string}`)).spot.find((x) => x.coin === "USDC")?.total ?? 0);
console.log("sender spot USDC before:", usdc(spotBefore), "receiver before:", recvBefore);

// The request really reaches HL, but we throw as if the response never came back.
const lostResponse = async (nonce: number, p: Parameters<typeof real>[1]) => { await real(nonce, p); throw new Error("simulated: response lost (fetch failed)"); };
const rec = await submitSpotSend(lostResponse, kv, ledger, "testnet", me, { purpose: "test", token: USDC, amount: "1", destination: receiver });
console.log("after lost response -> state:", rec.state, "| nonce:", rec.nonce, "| blocking:", !!ledger.blocking());

try {
  await submitSpotSend(real, kv, ledger, "testnet", me, { purpose: "test", token: USDC, amount: "1", destination: receiver });
  console.log("ERROR: second send was allowed");
} catch (e) { console.log("second send refused:", (e as Error).message.slice(0, 90)); }

const exported = ledger.get(rec.id)!; // the nonsecret journal entry a user could export
mem.clear();
console.log("local storage wiped; journal entries now:", new TransferLedger(kv, "testnet", me).list().length);
const fresh = new TransferLedger(kv, "testnet", me);
fresh.put(exported);
await new Promise((r) => setTimeout(r, 3000)); // info API lag
const out = await reconcileTransfer(hl.info, fresh, rec.id);
console.log("reconciled from HL ledger -> state:", out.state, "| evidence:", out.evidence, "| ledger hash:", out.ledgerHash, "| blocking:", !!fresh.blocking());

const spotAfter = await getBalances(hl, me);
const recvAfter = Number((await getBalances(hl, receiver as `0x${string}`)).spot.find((x) => x.coin === "USDC")?.total ?? 0);
console.log("sender spot USDC after:", usdc(spotAfter), "receiver after:", recvAfter, "| moved exactly once:", usdc(spotBefore) - usdc(spotAfter) === 1 + Number(out.fee ?? 0) && recvAfter - recvBefore === 1, "| fee charged to sender:", out.fee, out.feeToken);

// ---- C. alternate USDC route (initiate only)
console.log("\n== C. HL USDC withdrawal to Arbitrum Sepolia (own address)");
const perps = await getBalances(hl, me);
console.log("withdrawable before:", perps.withdrawable);
try {
  const r = await hl.exchange!.withdraw3({ destination: me, amount: process.env.WD_AMOUNT ?? "5" });
  console.log("withdraw3:", r);
} catch (e) { console.log("withdraw3 FAILED:", (e as Error).message); }
await new Promise((r) => setTimeout(r, 3000));
const ups = await hl.info.userNonFundingLedgerUpdates({ user: me, startTime: Date.now() - 5 * 60_000 });
console.log("ledger shows:", ups.filter((u: any) => u.delta.type === "withdraw").map((u: any) => u.delta));
console.log("withdrawable after:", (await getBalances(hl, me)).withdrawable);
