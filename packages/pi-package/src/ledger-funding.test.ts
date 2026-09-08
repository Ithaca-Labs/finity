import { describe, expect, it } from "vitest";
import { fundBrokerFromLedger, ledgerSignatureParity, resolveHederaAccountId, type FundingClient } from "./ledger-funding.js";

const principal = `0x${"11".repeat(20)}` as const;
const broker = `0x${"22".repeat(20)}` as const;

describe("ledger funding", () => {
  it("normalizes Ledger v conventions", () => {
    expect(ledgerSignatureParity(0)).toBe(0);
    expect(ledgerSignatureParity(28)).toBe(1);
    expect(ledgerSignatureParity(627)).toBe(0);
    expect(ledgerSignatureParity(628)).toBe(1);
    expect(() => ledgerSignatureParity(42)).toThrow();
  });

  it("builds, requests approval for, signs, and broadcasts one transfer", async () => {
    const calls: string[] = [];
    const publicClient: FundingClient = {
      getBalance: async () => 2_000_000_000_000_000_000n,
      getTransactionCount: async () => 7,
      getGasPrice: async () => 1n,
      estimateGas: async () => 21_000n,
      sendRawTransaction: async () => { calls.push("send"); return `0x${"33".repeat(32)}`; },
      waitForTransactionReceipt: async () => ({ status: "success" }),
    };
    const result = await fundBrokerFromLedger({
      brokerAddress: broker, amountTinybar: "100000000", derivationPath: "44'/60'/0'/0/0",
      confirm: async ({ principalAddress, amountTinybar }) => { expect(principalAddress).toBe(principal); expect(amountTinybar).toBe("100000000"); calls.push("confirm"); return true; },
    }, {
      publicClient,
      getAddress: async () => principal,
      signTransaction: async () => { calls.push("sign"); return { r: `0x${"44".repeat(32)}`, s: `0x${"55".repeat(32)}`, v: 27 }; },
    });
    expect(result).toEqual({ principalAddress: principal, transactionHash: `0x${"33".repeat(32)}` });
    expect(calls).toEqual(["confirm", "sign", "send"]);
  });

  it("never signs when the user cancels", async () => {
    let signed = false;
    const publicClient: FundingClient = {
      getBalance: async () => 2_000_000_000_000_000_000n, getTransactionCount: async () => 0,
      getGasPrice: async () => 1n, estimateGas: async () => 21_000n,
      sendRawTransaction: async () => `0x${"33".repeat(32)}`, waitForTransactionReceipt: async () => ({ status: "success" }),
    };
    await expect(fundBrokerFromLedger({ brokerAddress: broker, amountTinybar: "1", derivationPath: "44'/60'/0'/0/0", confirm: async () => false }, {
      publicClient, getAddress: async () => principal, signTransaction: async () => { signed = true; throw new Error("unexpected"); },
    })).rejects.toThrow("cancelled");
    expect(signed).toBe(false);
  });

  it("resolves a funded alias from the mirror node", async () => {
    let calls = 0;
    const account = await resolveHederaAccountId(broker, {
      attempts: 2, wait: async () => undefined,
      fetchImpl: async () => new Response(JSON.stringify(++calls === 1 ? {} : { account: "0.0.123" }), { status: calls === 1 ? 404 : 200 }),
    });
    expect(account).toBe("0.0.123");
  });
});
