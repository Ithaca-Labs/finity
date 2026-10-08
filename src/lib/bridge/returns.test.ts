import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import {
  checkReturnDestination, deriveReturn, markShielding, mergeReturnOperations, planReturn, reconcileReturnSend,
  submitReturnSend, toZatFloor, verifyWithdrawalResponse, SEND_NOT_LANDED_AFTER_MS, type ReturnRecord,
} from "./returns";
import { parseFees, type UnitOperation } from "./unit";
import { accountBalances, fullyAccounted } from "../accounting";
import { loadReturn, saveReturn } from "../store/funding-store";

// Live captures, 7 Oct 2026. The destinations are research fixtures (a docs example and a random key); never fund them.
const MAIN_DEST = "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs";
const MAIN_GEN = { address: "0x61868633c3499A907fcdF134a2D4fA6b31B4B8B0", signatures: {
  "field-node": "jRl+kX+4wnXwzrwh7QJeLU8XYqh2DXYB0v/nzsE9UNEijH7pmuJBP9sW/acLJuFUl4DM/Z5erCESPTnun/3V6w==",
  "hl-node": "wRJ5SjBF6d54ohFhKm7M8W39S9iWKs+ttevxMGaSndTdeNTWPU2ApiTF1hApyG9nwObOzTMtCCim1pogrtiFPQ==",
  "unit-node": "6EY4cJPUBRigKA/Ly5ABB+WlRnG6cDhz2byG9y70HIKJDM5OfE0xb8/+JOVAkDibkyNmqQcNkrH9L0FCLancnA==" } };
const TEST_DEST = "tmKGk1HesiH7P8naGnstRTzZhYVLH6G3AsN";
const TEST_GEN = { address: "0x4F29CDcF3b1542137996E51bb6D66d0cC78800f9", signatures: {
  "field-node": "09o5wDFbU9mbhzT2ji6hQFMGuXGjWCSGvLHpzDRVbtpWDPzGHsvFHnMDvR5kM6DOEgGQpxZaItIoVpHNy8ye9w==",
  "hl-node-testnet": "HbKwasoOSci93IpptVc9ku9BgfbIEFHyeTeosmyV54tqXkOHqsMWVS0BzVm07n4HTNOpO17kj4lnDVbDRLGECA==",
  "node-1": "XjdZ3XhpQhzfVgvJED1D7kleWY/VfkwGuZpSGW7aKUPSOfOv1aNu6xhjEgL1hpFeClquiiKfXTq/6l1RuHXSwg==" } };
const HL = "0x1f20B96A9fde5218ED05A212B2d23093100785c0";
const fees = parseFees({ zcash: { depositFee: 581428, depositEta: "126m", withdrawalFee: 15000, withdrawalEta: "5m" } });

describe("withdrawal route verification", () => {
  it("accepts live mainnet and testnet responses (3 of 3)", async () => {
    expect((await verifyWithdrawalResponse("mainnet", MAIN_DEST, MAIN_GEN)).verification.verifiedCount).toBe(3);
    const t = await verifyWithdrawalResponse("testnet", TEST_DEST, TEST_GEN);
    expect(t.unitHlAddress).toBe(TEST_GEN.address);
  });
  it("rejects a tampered Unit address or destination", async () => {
    await expect(verifyWithdrawalResponse("testnet", TEST_DEST, { ...TEST_GEN, address: MAIN_GEN.address })).rejects.toThrow(/Guardian/);
    await expect(verifyWithdrawalResponse("mainnet", "t1TRzgTAUKcbszYNq89agcKtwwWFTYbYUHQ", MAIN_GEN)).rejects.toThrow(/Guardian/);
  });
  it("rejects the other network's keys and fewer than 2 signatures", async () => {
    // A testnet route presented as mainnet fails at the destination check; force the key check with a mainnet dest.
    await expect(verifyWithdrawalResponse("mainnet", MAIN_DEST, { ...MAIN_GEN, signatures: TEST_GEN.signatures })).rejects.toThrow(/0 of 3/);
    const one = { "hl-node": MAIN_GEN.signatures["hl-node"] };
    await expect(verifyWithdrawalResponse("mainnet", MAIN_DEST, { ...MAIN_GEN, signatures: one })).rejects.toThrow(/1 of 3/);
  });
  it("only accepts a transparent P2PKH destination on the right network", () => {
    expect(checkReturnDestination(TEST_DEST, "testnet").ok).toBe(true);
    expect(checkReturnDestination(MAIN_DEST, "testnet").ok).toBe(false);
    expect(checkReturnDestination("textest1thdh90ttywp4tjf9ljc7q5u8sa564ggp9jt7yf", "testnet").ok).toBe(false);
    expect(checkReturnDestination(TEST_DEST + " ", "testnet").ok).toBe(false);
  });
});

describe("return amount", () => {
  it("truncates, never rounds up", () => {
    expect(toZatFloor("0.123456789")).toBe(12345678n);
    expect(toZatFloor("0.129", 2)).toBe(12000000n);
  });
  it("refuses below the 0.07 minimum and reports the residual", () => {
    const p = planReturn("0.0699", 8, fees);
    expect(p).toMatchObject({ ok: false, kind: "below_minimum", residualZat: 6990000n });
  });
  it("returns the whole available balance net of the outbound fee", () => {
    expect(planReturn("0.09418572", 8, fees)).toMatchObject({ ok: true, sendAmount: "0.09418572", estNetZat: 9418572n - 15000n });
  });
});

function freshRecord(): ReturnRecord {
  return {
    network: "testnet", hlAddress: HL, source: "unit-live", operations: {}, shielding: "not_delivered",
    route: { source: "unit-live", network: "testnet", destination: TEST_DEST, unitHlAddress: TEST_GEN.address as `0x${string}`, verification: { success: true, verifiedCount: 3, details: {} } },
  };
}
const memKv = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const SEND = { token: "XZEC:0xc8e8047efa1400eb0b7b9bbee16b759d", amount: "0.1" };

describe("return send journaling", () => {
  it("persists pending before signing; a crash mid-send reloads as outcome_unknown", async () => {
    const kv = memKv();
    const persist = (r: ReturnRecord) => saveReturn(kv, r);
    let seenPending = false;
    const api = { userNonFundingLedgerUpdates: async () => [], spotSend: async () => { seenPending = loadReturn(kv, freshRecord())?.send?.state === "pending"; return new Promise(() => {}); } };
    void submitReturnSend(api, freshRecord(), persist, SEND); // never resolves: tab closed
    await new Promise((r) => setTimeout(r, 0));
    expect(seenPending).toBe(true);
    const reloaded = loadReturn(kv, freshRecord())!;
    expect(deriveReturn(reloaded)).toMatchObject({ state: "outcome_unknown", maySend: false });
  });
  it("a timeout is unknown and blocks a second send; a rejection does not", async () => {
    const timeout = { userNonFundingLedgerUpdates: async () => [], spotSend: async () => { throw new Error("timeout"); } };
    const r = await submitReturnSend(timeout, freshRecord(), () => {}, SEND);
    expect(r.send!.state).toBe("unknown");
    await expect(submitReturnSend(timeout, r, () => {}, SEND)).rejects.toThrow(/Reconcile/);
    const rej = await submitReturnSend({ userNonFundingLedgerUpdates: async () => [], spotSend: async () => { throw new ApiRequestError({} as any, "Insufficient balance"); } }, freshRecord(), () => {}, SEND);
    expect(deriveReturn(rej)).toMatchObject({ state: "recoverable_error", maySend: true });
  });
  it("reconciles an unknown send from the HL ledger by nonce", async () => {
    const r = await submitReturnSend({ userNonFundingLedgerUpdates: async () => [], spotSend: async () => { throw new Error("socket hang up"); } }, freshRecord(), () => {}, SEND);
    const ledger = { userNonFundingLedgerUpdates: async () => [
      { hash: "0xold", delta: { type: "spotTransfer", destination: TEST_GEN.address.toLowerCase(), token: "XZEC", amount: "0.1", nonce: r.send!.nonceFloor - 5 } },
      { hash: "0xmine", delta: { type: "spotTransfer", destination: TEST_GEN.address.toLowerCase(), token: "XZEC", amount: "0.1", nonce: r.send!.nonceFloor + 3 } },
    ] };
    const out = await reconcileReturnSend(ledger, r, () => {});
    expect(out.send).toMatchObject({ state: "sent", hash: "0xmine", evidence: "reconciled_ledger" });
    expect(deriveReturn(out).state).toBe("bridge_return_pending");
  });
  it("declares not landed only after the wait, then allows a new send", async () => {
    const r = await submitReturnSend({ userNonFundingLedgerUpdates: async () => [], spotSend: async () => { throw new Error("timeout"); } }, freshRecord(), () => {}, SEND);
    const empty = { userNonFundingLedgerUpdates: async () => [] };
    expect((await reconcileReturnSend(empty, r, () => {}, r.send!.nonceFloor + 1000)).send!.state).toBe("unknown");
    const late = await reconcileReturnSend(empty, r, () => {}, r.send!.nonceFloor + SEND_NOT_LANDED_AFTER_MS + 1);
    expect(deriveReturn(late)).toMatchObject({ state: "return_token_ready", maySend: true });
  });
});

const op = (state: string, extra: Partial<UnitOperation> = {}): UnitOperation => ({
  operationId: "w1", protocolAddress: TEST_GEN.address, sourceChain: "hyperliquid", destinationChain: "zcash", destinationAddress: TEST_DEST, state, ...extra,
});

describe("cleared local storage", () => {
  it("a send already in the HL ledger blocks a new one even with no local record", async () => {
    let sent = false;
    const api = { spotSend: async () => { sent = true; }, userNonFundingLedgerUpdates: async () => [
      { hash: "0xlost", delta: { type: "spotTransfer", destination: TEST_GEN.address.toLowerCase(), token: "XZEC", amount: "0.1", nonce: Date.now() - 60_000 } },
      { hash: "0xother", delta: { type: "spotTransfer", destination: "0x0000000000000000000000000000000000000001", token: "USDC", amount: "1" } },
    ] };
    await expect(submitReturnSend(api, freshRecord(), () => {}, SEND)).rejects.toThrow(/0xlost/);
    expect(sent).toBe(false);
  });
});

describe("return status from evidence", () => {
  const sent = async () => submitReturnSend({ userNonFundingLedgerUpdates: async () => [], spotSend: async () => ({ status: "ok" }) }, freshRecord(), () => {}, SEND);
  it("delivered only with a done op and a destination tx; shielding is a separate, labelled step", async () => {
    let r = mergeReturnOperations(await sent(), [op("done")]);
    expect(deriveReturn(r).state).toBe("bridge_return_pending");
    r = mergeReturnOperations(r, [op("done", { destinationTxHash: "ztx1" })]);
    expect(deriveReturn(r).explanation).toMatch(/open the wallet and shield/);
    expect(deriveReturn(markShielding(r, "user_marked_shielded")).state).toBe("user_marked_shielded");
    expect(() => markShielding(freshRecord(), "user_marked_shielded")).toThrow();
  });
  it("ignores operations for other destinations and keeps old ones when a poll omits them", async () => {
    let r = mergeReturnOperations(await sent(), [op("buildingDstTx"), op("done", { operationId: "x", destinationAddress: "tmOther" })]);
    r = mergeReturnOperations(r, []);
    expect(Object.keys(r.operations)).toEqual(["w1"]);
  });
  it("a Unit failure goes to manual recovery", async () => {
    expect(deriveReturn(mergeReturnOperations(await sent(), [op("failure")])).state).toBe("manual_recovery");
  });
});

describe("balance accounting", () => {
  it("puts every balance in a bucket; an unknown send is flagged unaccounted", async () => {
    const spot = [{ coin: "XZEC", token: 1526, total: "0.05", hold: "0" }, { coin: "USDC", token: 0, total: "4.2", hold: "0" }];
    const lines = accountBalances({ perpsAccountValue: "399.9", spot, unitTokenIndex: 1526 });
    expect(lines.map((l) => l.bucket)).toEqual(["user_control", "residual", "residual"]);
    const unk = await submitReturnSend({ userNonFundingLedgerUpdates: async () => [], spotSend: async () => { throw new Error("timeout"); } }, freshRecord(), () => {}, SEND);
    const withSend = accountBalances({ perpsAccountValue: "0", spot: [], unitTokenIndex: 1526, ret: { rec: unk, view: deriveReturn(unk) } });
    expect(fullyAccounted(withSend)).toBe(false);
  });
});
