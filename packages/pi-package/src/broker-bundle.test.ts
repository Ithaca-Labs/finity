import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WalletCliError, generateBrokerSessionKey, sealBrokerBundle, verifyBrokerBundleRecovery } from "./broker-bundle.js";

describe("generateBrokerSessionKey", () => {
  it("generates a valid EVM keypair", () => {
    const { brokerSessionKey, brokerAddress } = generateBrokerSessionKey();
    expect(brokerSessionKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(brokerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("never repeats a key across calls", () => {
    const a = generateBrokerSessionKey();
    const b = generateBrokerSessionKey();
    expect(a.brokerSessionKey).not.toBe(b.brokerSessionKey);
    expect(a.brokerAddress).not.toBe(b.brokerAddress);
  });
});

const bundle = { brokerSessionKey: "302e...placeholder", spendAccountId: "0.0.123", brokerUaid: "did:aid:broker" };

describe("sealBrokerBundle", () => {
  it("pipes the canonical bundle JSON to wallet-cli ring encrypt and injects WALLET_PASS only via env", async () => {
    let seenArgs: string[] = [];
    let seenInput = "";
    let seenEnv: Record<string, string> = {};
    await sealBrokerBundle({
      brokerId: "b1",
      bundle,
      outputPath: "/tmp/broker.enc",
      walletPass: async () => "throwaway-test-password",
      runWalletCli: async (args, input, env) => {
        seenArgs = args;
        seenInput = input.toString("utf8");
        seenEnv = env;
      },
    });
    expect(seenArgs).toEqual(["ring", "encrypt", "--key", "broker:b1", "-o", "/tmp/broker.enc"]);
    expect(JSON.parse(seenInput)).toEqual(bundle);
    expect(seenEnv.WALLET_PASS).toBe("throwaway-test-password");
    expect(seenArgs.join(" ")).not.toContain("throwaway-test-password");
  });

  it("fails closed when the wallet password is unavailable, without calling wallet-cli", async () => {
    let called = false;
    await expect(
      sealBrokerBundle({
        brokerId: "b1",
        bundle,
        outputPath: "/tmp/broker.enc",
        walletPass: async () => "",
        runWalletCli: async () => {
          called = true;
        },
      }),
    ).rejects.toThrow(WalletCliError);
    expect(called).toBe(false);
  });
});

describe("verifyBrokerBundleRecovery against the real installed wallet-cli", () => {
  it("fails closed when the Key Ring has not been initialized on this machine", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finity-broker-bundle-"));
    const bundlePath = join(dir, "broker.enc");
    writeFileSync(bundlePath, Buffer.from("not a real ciphertext"));
    try {
      await expect(
        verifyBrokerBundleRecovery({ brokerId: "b1", bundlePath, walletPass: async () => "throwaway-test-password" }),
      ).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it("fails closed when the sealed bundle file does not exist", async () => {
    await expect(
      verifyBrokerBundleRecovery({ brokerId: "b1", bundlePath: "/nonexistent/broker.enc", walletPass: async () => "x" }),
    ).rejects.toThrow(WalletCliError);
  });
});
