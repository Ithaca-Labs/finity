import { describe, expect, it } from "vitest";
import { checkFundingAmount, crossCheckMapping, parseFees, verifyDepositResponse } from "./unit";
import { deriveFunding, mergeOperations, recordPollError, type FundingRecord } from "./funding";
import { ReplayBridgeAdapter } from "../replay/unit-replay";
import { texToP2pkh, parseZcashAddress, zecToZatoshis } from "../zcash/address";

const HL = "0x1f20B96A9fde5218ED05A212B2d23093100785c0" as const;
const fees = parseFees({ zcash: { depositFee: 581428, depositEta: "126m", withdrawalFee: 15000, withdrawalEta: "5m" } });

describe("deposit response verification", () => {
  const gen = async () => (await new ReplayBridgeAdapter("testnet", "awaiting").generateDeposit(HL));
  it("accepts the captured live response and keeps the address as returned", async () => {
    const d = await gen();
    expect(d.payAddress).toBe("tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy");
    expect(d.verification.verifiedCount).toBe(3);
  });
  it("verifies a TEX response through its P2PKH form and pays the TEX string", async () => {
    const d = await gen();
    const tex = "textest1thdh90ttywp4tjf9ljc7q5u8sa564ggp9jt7yf";
    expect(texToP2pkh(parseZcashAddress(tex))).toBe(d.payAddress);
    const sigs = { "field-node": "6ax+LLsaw2lTwDfpFmPSQrXk7zExryl0eGAbKxAeGRi64wIHs7OFrSoEZUd/6KFiVYKcbg/+tG8pr/BwJV6C1Q==", "node-1": "9aWN76MZ+NaO3tSejx85PDH92Zsk4a4mo071UDNIDZWueJu2xJPKoTxbsU0PyJIym3XmACfIiisb6WyUWX1w3g==" };
    const v = await verifyDepositResponse("testnet", HL, { address: tex, signatures: sigs });
    expect(v.payAddress).toBe(tex);
    expect(v.payKind).toBe("tex");
  });
  it("rejects a response for a different HL account", async () => {
    const d = await gen();
    await expect(verifyDepositResponse("testnet", "0x0000000000000000000000000000000000000001", { address: d.payAddress, signatures: {} })).rejects.toThrow();
  });
  it("rejects a mainnet-network address on testnet", async () => {
    await expect(verifyDepositResponse("mainnet", HL, { address: "tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy", signatures: {} })).rejects.toThrow(/testnet address on mainnet/);
  });
  it("cross-checks the /operations mapping by key, rejecting a different key", async () => {
    const d = await gen();
    expect(crossCheckMapping(d, [{ address: "textest1thdh90ttywp4tjf9ljc7q5u8sa564ggp9jt7yf", sourceCoinType: "zcash" }]).ok).toBe(true);
    expect(crossCheckMapping(d, [{ address: "tmEQBVKVBNyKUgJWNZ8xqKs5b3sGmzCGCvd", sourceCoinType: "zcash" }]).ok).toBe(false);
  });
  it("replay refuses mainnet", () => {
    expect(() => new ReplayBridgeAdapter("mainnet", "happy")).toThrow();
  });
});

describe("funding amount gate", () => {
  it("blocks below 0.07 ZEC plus fee, allows at the floor, caps at 2 ZEC", () => {
    expect(checkFundingAmount(zecToZatoshis("0.07"), fees).ok).toBe(false);
    expect(checkFundingAmount(zecToZatoshis("0.07581428"), fees).ok).toBe(true);
    expect(checkFundingAmount(zecToZatoshis("2.1"), fees).ok).toBe(false);
  });
});

describe("funding state", () => {
  const rec: FundingRecord = { network: "testnet", hlAddress: HL, payAddress: "tm…", source: "replay", operations: {} };
  const op = (state: string, tx = "tx1:0") => ({ operationId: "o", protocolAddress: "p", sourceChain: "zcash", destinationChain: "hyperliquid", destinationAddress: HL, state, sourceTxHash: tx });

  it("shows payment request only with no deposit and healthy polling", () => {
    expect(deriveFunding(rec, null).mayShowPaymentRequest).toBe(true);
    const err = recordPollError(rec, "503");
    expect(deriveFunding(err, null)).toMatchObject({ state: "recoverable_error", mayShowPaymentRequest: false });
  });
  it("a provider error after a deposit keeps the deposit and never re-suggests paying", () => {
    const seen = mergeOperations(rec, [op("waitForSrcTxFinalization")]);
    const v = deriveFunding(recordPollError(seen, "timeout"), null);
    expect(v).toMatchObject({ state: "bridge_pending", stale: true, mayShowPaymentRequest: false });
    expect(v.operations).toHaveLength(1);
  });
  it("an empty later poll does not drop a known operation", () => {
    const seen = mergeOperations(rec, [op("sourceTxDiscovered")]);
    expect(deriveFunding(mergeOperations(seen, []), null).state).toBe("deposit_seen");
  });
  it("dedupes by source tx identity and takes the latest state", () => {
    const r = mergeOperations(mergeOperations(rec, [op("sourceTxDiscovered")]), [op("done")]);
    expect(Object.keys(r.operations)).toEqual(["tx1:0"]);
  });
  it("done needs a token balance before claiming receipt", () => {
    const done = mergeOperations(rec, [op("done")]);
    expect(deriveFunding(done, 0).state).toBe("bridge_pending");
    expect(deriveFunding(done, 0.09).state).toBe("unit_token_received");
  });
  it("ignores operations for another account or chain", () => {
    const other = { ...op("done"), destinationAddress: "0x0000000000000000000000000000000000000001" };
    expect(deriveFunding(mergeOperations(rec, [other]), null).state).toBe("awaiting_deposit");
  });
  it("surfaces below-minimum, failure and unknown states", () => {
    expect(deriveFunding(mergeOperations(rec, [{ ...op("failure"), error: "amount below minimum" }]), null).state).toBe("below_minimum_stuck");
    expect(deriveFunding(mergeOperations(rec, [op("failure")]), null).state).toBe("manual_recovery");
    expect(deriveFunding(mergeOperations(rec, [op("someNewState")]), null).state).toBe("manual_recovery");
  });
  it("replay happy path walks seen -> pending -> done", async () => {
    let t = 0;
    const a = new ReplayBridgeAdapter("testnet", "happy", 0, () => t * 1000);
    const states: string[] = [];
    let r = { ...rec };
    for (t of [0, 6, 30, 140]) { r = mergeOperations(r, (await a.operations(HL)).operations); states.push(deriveFunding(r, t >= 140 ? 0.09 : 0).state); }
    expect(states).toEqual(["awaiting_deposit", "deposit_seen", "bridge_pending", "unit_token_received"]);
  });
});
