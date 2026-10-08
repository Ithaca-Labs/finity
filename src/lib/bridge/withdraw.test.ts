import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import { balanceToZat, fmtZec, planReturn, recoveryOptions, validateReturnDestination, verifyWithdrawalResponse } from "./withdraw";
import { parseFees } from "./unit";
import { deriveReturn } from "./return-state";
import { overrideNotLanded, reconcileTransfer, submitSpotSend, TRANSFER_SETTLE_MS, TransferBlockedError, TransferLedger } from "../hl/transfer";

const ME = "0x1f20B96A9fde5218ED05A212B2d23093100785c0" as const;
const UNIT_PROTO = "0x4E6091f91c8174466337E09F79b37056B150c3a1" as const;
const DEST = "t1SRsjhoLEGvugRGdBBHmxqxCs5ohKtjuRo"; // probe-only mainnet t1, never funded
// Live mainnet response captured 8 Oct 2026 (fixture, not a settlement trace).
const live = {
  address: UNIT_PROTO,
  signatures: {
    "field-node": "by+MWVn2294b62AFwcdIkAn9d/hk64TrDN8dfVvkRioH/hlC33I7hDDJaCy3AOs+VSqv41ALAoHNWOAQdk+5IA==",
    "hl-node": "EloyU4UP+iz1wUWB+7NquegGGpeNc12VmrEUIL+F7izfEkRRQPg27zJ9Xf+NfXfluqdAJMU8+Qn0fdsbHSfJHQ==",
    "unit-node": "GzX0I+znlOuSx3prZA1J2C5R1o6xR5pqTm2I5n3zti9qyAFrjtSBdpja3oo9/5gYDvLoWvGHRuRRtzKk7oadag==",
  },
};
const fees = parseFees({ zcash: { depositFee: 581428, depositEta: "126m", withdrawalFee: 15000, withdrawalEta: "5m" } });
const zec = (s: string) => balanceToZat(s);

describe("withdrawal address verification", () => {
  it("accepts the live mainnet response (3 of 3 guardians)", async () => {
    const w = await verifyWithdrawalResponse("mainnet", DEST, ME, live);
    expect(w.protocolAddress).toBe(UNIT_PROTO);
    expect(w.verification.verifiedCount).toBe(3);
  });
  it("rejects a swapped protocol address", async () => {
    await expect(verifyWithdrawalResponse("mainnet", DEST, ME, { ...live, address: "0x0000000000000000000000000000000000000000" })).rejects.toThrow(/zero/);
    await expect(verifyWithdrawalResponse("mainnet", DEST, ME, { ...live, address: "0x1111111111111111111111111111111111111111" })).rejects.toThrow(/Guardian/);
  });
  it("rejects a different destination than the one signed", async () => {
    await expect(verifyWithdrawalResponse("mainnet", "t1Vpa8HVRthC3KpDwr8y1UJjN5TUdgxaE2P", ME, live)).rejects.toThrow();
  });
  it("rejects fewer than 2 signatures", async () => {
    await expect(verifyWithdrawalResponse("mainnet", DEST, ME, { ...live, signatures: { "hl-node": live.signatures["hl-node"] } })).rejects.toThrow(/Guardian/);
  });
  it("rejects the user's own account as protocol address", async () => {
    await expect(verifyWithdrawalResponse("mainnet", DEST, ME, { ...live, address: ME })).rejects.toThrow(/own account/);
  });
  it("rejects testnet use of a mainnet destination", async () => {
    await expect(verifyWithdrawalResponse("testnet", DEST, ME, live)).rejects.toThrow(/mainnet address/);
  });
});

describe("return destination", () => {
  it("accepts a transparent address on the right network", () => {
    expect(validateReturnDestination("mainnet", DEST).ok).toBe(true);
    expect(validateReturnDestination("testnet", "tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy").ok).toBe(true);
  });
  it("refuses shielded/unified destinations with the shield-in-wallet explanation", () => {
    const r = validateReturnDestination("testnet", "utest1a55lsx23zsc37dyecq8k6ae6sd5dnsnxgc52ts9m68nr2x9qhlq2gerf20f4q0j2l23n8sqv0kd86zdfrukadp9ne3s6vusee8g2dz4l56yqms86q2qsgmpxkh0lfpklsfa35qae5pe5dc2nnqhh762cfyktty3j7j96env5vezh4ufmq4w25amemwu3e4jt7sasq7z2m936un6hvhl");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/transparent/);
  });
  it("refuses a wrong-network address, a bad checksum and TEX", () => {
    expect(validateReturnDestination("testnet", DEST).ok).toBe(false);
    expect(validateReturnDestination("mainnet", DEST.slice(0, -1) + "x").ok).toBe(false);
    expect(validateReturnDestination("testnet", "textest1thdh90ttywp4tjf9ljc7q5u8sa564ggp9jt7yf").ok).toBe(false);
  });
});

describe("return planning: minimum, fee and residual", () => {
  it("plans a normal return with the exact net and residual", () => {
    const p = planReturn({ balanceZat: zec("0.5"), requestedZat: zec("0.4"), fees });
    expect(p.ok && p.netZat).toBe(zec("0.4") - 15000n);
    expect(p.ok && p.residualZat).toBe(zec("0.1"));
  });
  it("blocks a balance below the 0.07 ZEC minimum and shows the exact residual with recovery options", () => {
    const p = planReturn({ balanceZat: zec("0.05"), requestedZat: zec("0.05"), fees });
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.kind).toBe("below_minimum");
    expect(p.residualZat).toBe(zec("0.05"));
    expect(p.reason).toMatch(/0\.05 ZEC/);
    expect(p.recovery.map((r) => r.id)).toContain("keep_in_account");
  });
  it("blocks sending less than the minimum even when the balance is larger", () => {
    const p = planReturn({ balanceZat: zec("0.5"), requestedZat: zec("0.05"), fees });
    expect(!p.ok && p.kind).toBe("below_minimum");
    expect(!p.ok && p.residualZat).toBe(zec("0.5")); // nothing leaves; all of it is still the user's
  });
  it("warns when the leftover would itself be unreturnable", () => {
    const p = planReturn({ balanceZat: zec("0.12"), requestedZat: zec("0.08"), fees });
    expect(p.ok && p.warnings[0]).toMatch(/below the minimum/);
  });
  it("rejects more than the balance, zero and a fee that eats the amount", () => {
    expect(planReturn({ balanceZat: zec("0.2"), requestedZat: zec("0.3"), fees }).ok).toBe(false);
    expect(planReturn({ balanceZat: zec("0.2"), requestedZat: 0n, fees }).ok).toBe(false);
    expect(planReturn({ balanceZat: zec("0.2"), requestedZat: zec("0.1"), fees: { ...fees, withdrawalFeeZat: zec("0.1") }, minZat: 1n }).ok).toBe(false);
  });
  it("floors HL decimal balances and never rounds up", () => {
    expect(balanceToZat("0.123456789")).toBe(12345678n);
    expect(fmtZec(12345678n)).toBe("0.12345678");
    expect(() => balanceToZat("1e-7")).toThrow();
  });
  it("labels recovery options by evidence and does not call untested routes tested", () => {
    const o = recoveryOptions(zec("0.05"));
    expect(o.find((x) => x.id === "wait_for_unit_minimum")!.status).toBe("documented_only");
    expect(o.find((x) => x.id === "usdc_bridge_withdraw")!.status).toBe("attempt_failed");
  });
});

describe("return state: evidence only", () => {
  const done = { operationId: "x", protocolAddress: UNIT_PROTO, sourceChain: "hyperliquid", destinationChain: "zcash", destinationAddress: DEST, state: "done", destinationTxHash: "abcd" };
  it("delivered_transparent only with Unit done AND a Zcash tx hash", () => {
    expect(deriveReturn({ tokenBalanceZat: 0n, withdrawalOp: done }).state).toBe("delivered_transparent");
    expect(deriveReturn({ tokenBalanceZat: 0n, withdrawalOp: { ...done, destinationTxHash: undefined } }).state).toBe("bridge_return_pending");
  });
  it("a user tick is 'you marked shielded', a spent output is 'transparent output spent', neither is wallet-confirmed", () => {
    const tick = deriveReturn({ tokenBalanceZat: 0n, withdrawalOp: done, userMarkedShielded: true });
    expect(tick.shielding).toBe("you_marked_shielded");
    expect(tick.state).not.toBe("wallet_confirmed_shielded");
    const spent = deriveReturn({ tokenBalanceZat: 0n, withdrawalOp: done, transparentOutputSpentTxid: "ff" });
    expect(spent.shielding).toBe("transparent_output_spent");
    expect(spent.explanation).toMatch(/does not prove/);
    expect(spent.state).toBe("shielding_pending");
  });
  it("wallet_confirmed_shielded requires wallet evidence", () => {
    const v = deriveReturn({ tokenBalanceZat: 0n, withdrawalOp: done, walletEvidence: { kind: "wallet", txid: "aa", confirmedAt: "2026-10-08" } });
    expect(v.state).toBe("wallet_confirmed_shielded");
  });
  it("lifecycle states are pending, and an unrecognised Unit state goes to manual recovery", () => {
    for (const s of ["sourceTxDiscovered", "waitForSrcTxFinalization", "readyForWithdrawQueue", "queuedForWithdraw"]) {
      expect(deriveReturn({ tokenBalanceZat: 0n, withdrawalOp: { ...done, state: s, destinationTxHash: undefined } }).state).toBe("bridge_return_pending");
    }
    expect(deriveReturn({ tokenBalanceZat: 0n, withdrawalOp: { ...done, state: "mystery" } }).state).toBe("manual_recovery");
    expect(deriveReturn({ tokenBalanceZat: 0n, withdrawalOp: { ...done, state: "failure" } }).state).toBe("manual_recovery");
  });
  it("send-before-token, unknown transfer and rejection map to the right states", () => {
    expect(deriveReturn({ tokenBalanceZat: zec("0.2") }).state).toBe("return_token_ready");
    expect(deriveReturn({ tokenBalanceZat: 0n, conversionState: "partial" }).state).toBe("return_conversion_pending");
    expect(deriveReturn({ tokenBalanceZat: zec("0.2"), transfer: { state: "unknown" } }).state).toBe("outcome_unknown");
    expect(deriveReturn({ tokenBalanceZat: zec("0.2"), transfer: { state: "rejected", error: "x" } }).state).toBe("recoverable_error");
    expect(deriveReturn({ tokenBalanceZat: 0n, transfer: { state: "sent" } }).state).toBe("bridge_return_pending");
  });
});

describe("transfer journal: failure injection", () => {
  const mem = () => { const m = new Map<string, string>(); return { m, kv: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }; };
  const REQ = { purpose: "unit_withdrawal", token: "UZEC:0x1c994ad3381d31c86c8c2d74ed89a365", amount: "0.1", destination: UNIT_PROTO };

  it("journals before sending: the pending record exists while the request is in flight", async () => {
    const { kv } = mem(); const ledger = new TransferLedger(kv, "mainnet", ME);
    let seenDuring: string | undefined;
    await submitSpotSend(async () => { seenDuring = ledger.list()[0]?.state; }, kv, ledger, "mainnet", ME, REQ);
    expect(seenDuring).toBe("pending");
    expect(ledger.list()[0].state).toBe("sent");
  });
  it("a timeout after submission is unknown and blocks a second send (no double spend)", async () => {
    const { kv } = mem(); const ledger = new TransferLedger(kv, "mainnet", ME);
    const r = await submitSpotSend(async () => { throw new Error("fetch failed"); }, kv, ledger, "mainnet", ME, REQ);
    expect(r.state).toBe("unknown");
    let called = false;
    await expect(submitSpotSend(async () => { called = true; }, kv, ledger, "mainnet", ME, REQ)).rejects.toBeInstanceOf(TransferBlockedError);
    expect(called).toBe(false);
  });
  it("an explicit exchange rejection is final and does not block", async () => {
    const { kv } = mem(); const ledger = new TransferLedger(kv, "mainnet", ME);
    const r = await submitSpotSend(async () => { throw new ApiRequestError({}, "Insufficient balance"); }, kv, ledger, "mainnet", ME, REQ);
    expect(r.state).toBe("rejected");
    expect((await submitSpotSend(async () => {}, kv, ledger, "mainnet", ME, REQ)).state).toBe("sent");
  });
  it("two concurrent clicks send once", async () => {
    const { kv } = mem(); const ledger = new TransferLedger(kv, "mainnet", ME);
    let calls = 0;
    const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); };
    const res = await Promise.allSettled([submitSpotSend(slow, kv, ledger, "mainnet", ME, REQ), submitSpotSend(slow, kv, ledger, "mainnet", ME, REQ)]);
    expect(calls).toBe(1);
    expect(res.filter((x) => x.status === "rejected")).toHaveLength(1);
  });
  it("uses a fresh increasing nonce per transfer", async () => {
    const { kv } = mem(); const ledger = new TransferLedger(kv, "mainnet", ME);
    const nonces: number[] = [];
    for (let i = 0; i < 3; i++) await submitSpotSend(async (n) => { nonces.push(n); }, kv, ledger, "mainnet", ME, REQ);
    expect(new Set(nonces).size).toBe(3);
    expect([...nonces].sort((a, b) => a - b)).toEqual(nonces);
  });
  it("refuses to send to itself", async () => {
    const { kv } = mem();
    await expect(submitSpotSend(async () => {}, kv, new TransferLedger(kv, "mainnet", ME), "mainnet", ME, { ...REQ, destination: ME })).rejects.toThrow(/same account/);
  });

  it("reconciles an unknown send from HL's ledger by nonce after ALL local storage is wiped", async () => {
    const { m, kv } = mem(); const ledger = new TransferLedger(kv, "mainnet", ME);
    const r = await submitSpotSend(async () => { throw new Error("network down"); }, kv, ledger, "mainnet", ME, REQ);
    // HL actually processed it; the response was lost. Local storage is then cleared, but the cloud state is intact.
    const hl = { userNonFundingLedgerUpdates: async () => [{ time: 1, hash: "0xhash", delta: { type: "spotTransfer", nonce: r.nonce, user: ME, destination: UNIT_PROTO, fee: "1.0", feeToken: "USDC" } }] };
    const saved = ledger.get(r.id)!;
    m.clear();
    const fresh = new TransferLedger(kv, "mainnet", ME);
    expect(fresh.list()).toHaveLength(0); // the journal is gone: the account must still be recoverable from HL alone
    fresh.put(saved); // the recovery client re-imports the exported nonsecret journal entry
    const out = await reconcileTransfer(hl, fresh, r.id);
    expect(out.state).toBe("sent");
    expect(out.evidence).toBe("reconciled_ledger");
    expect(out.fee).toBe("1.0"); // the sender-paid fee is read back from HL, not assumed
    expect(out.feeToken).toBe("USDC");
  });
  it("ignores a ledger entry with a different nonce, destination or sender", async () => {
    const { kv } = mem(); const ledger = new TransferLedger(kv, "mainnet", ME);
    const r = await submitSpotSend(async () => { throw new Error("x"); }, kv, ledger, "mainnet", ME, REQ);
    const bad = [
      { delta: { type: "spotTransfer", nonce: r.nonce + 1, user: ME, destination: UNIT_PROTO } },
      { delta: { type: "spotTransfer", nonce: r.nonce, user: ME, destination: "0x2222222222222222222222222222222222222222" } },
      { delta: { type: "spotTransfer", nonce: r.nonce, user: "0x3333333333333333333333333333333333333333", destination: UNIT_PROTO } },
    ];
    const out = await reconcileTransfer({ userNonFundingLedgerUpdates: async () => bad }, ledger, r.id);
    expect(out.state).toBe("unknown");
  });
  it("a stale or failing provider read leaves the record unknown and still blocking", async () => {
    const { kv } = mem(); const ledger = new TransferLedger(kv, "mainnet", ME);
    const r = await submitSpotSend(async () => { throw new Error("x"); }, kv, ledger, "mainnet", ME, REQ);
    await expect(reconcileTransfer({ userNonFundingLedgerUpdates: async () => { throw new Error("503"); } }, ledger, r.id)).rejects.toThrow("503");
    expect(ledger.get(r.id)!.state).toBe("unknown");
    expect(ledger.blocking()?.id).toBe(r.id);
  });
  it("not-in-ledger is never proof: override only after the settling period, and it is recorded", async () => {
    const { kv } = mem(); const ledger = new TransferLedger(kv, "mainnet", ME);
    const r = await submitSpotSend(async () => { throw new Error("x"); }, kv, ledger, "mainnet", ME, REQ);
    const empty = { userNonFundingLedgerUpdates: async () => [] };
    const early = await reconcileTransfer(empty, ledger, r.id);
    expect(early.state).toBe("unknown");
    expect(() => overrideNotLanded(ledger, r.id)).toThrow(/Too early/);
    const later = Date.parse(r.createdAt) + TRANSFER_SETTLE_MS + 1;
    expect((await reconcileTransfer(empty, ledger, r.id, later)).error).toMatch(/explicit override/);
    const o = overrideNotLanded(ledger, r.id, later);
    expect(o.state).toBe("not_landed");
    expect(o.evidence).toBe("user_override");
    expect(ledger.blocking()).toBeUndefined();
  });
  it("storage that throws or is missing does not crash the read path", () => {
    const ledger = new TransferLedger(undefined, "mainnet", ME);
    expect(ledger.list()).toEqual([]);
    const broken = new TransferLedger({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} }, "mainnet", ME);
    expect(() => broken.list()).not.toThrow();
  });
});
