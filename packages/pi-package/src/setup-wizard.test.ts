import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSetupWizard, type SetupWizardDeps } from "./setup-wizard.js";

function fakeUi(input: string | undefined = "0.0.123") {
  const messages: string[] = [];
  return {
    ui: {
      notify: (message: string) => { messages.push(message); },
      confirm: async () => true,
      input: async () => input,
    },
    messages,
  };
}

function baseDeps(overrides: Partial<SetupWizardDeps> = {}): SetupWizardDeps {
  const { ui } = fakeUi();
  const bundlesDir = mkdtempSync(join(tmpdir(), "finity-setup-test-"));
  return {
    ui,
    genuineCheck: async () => true,
    ringInit: async () => true,
    walletPass: async () => "throwaway-test-password",
    bundlesDir,
    identityPath: join(bundlesDir, "identity.json"),
    brokerId: "default",
    hostname: "test-host",
    generateBrokerSessionKey: () => ({ brokerSessionKey: `0x${"11".repeat(32)}`, brokerAddress: `0x${"22".repeat(20)}` }),
    generateIdentity: async () => ({ uaid: "uaid:aid:broker", canonical: { registry: "finity", name: "finity-broker", version: "1", protocol: "finity/1", nativeId: "hedera:testnet:0.0.123", skills: [] }, canonicalJson: "{}" }),
    sealBrokerBundle: async () => undefined,
    verifyBrokerBundleRecovery: async () => true,
    saveIdentityFile: async () => undefined,
    moveBundle: async () => undefined,
    fundingAmountTinybar: "100000000",
    fundBroker: async ({ brokerAddress, amountTinybar, confirm }) => {
      await confirm({ principalAddress: `0x${"33".repeat(20)}`, brokerAddress, amountTinybar, maxFeeTinybar: "1" });
      return { principalAddress: `0x${"33".repeat(20)}`, transactionHash: `0x${"44".repeat(32)}` };
    },
    resolveHederaAccountId: async () => "0.0.123",
    ...overrides,
  };
}

describe("runSetupWizard", () => {
  it("completes the full happy path and returns the broker's address and Spend Account", async () => {
    const result = await runSetupWizard(baseDeps());
    expect(result).toEqual({ ok: true, brokerAddress: `0x${"22".repeat(20)}`, spendAccountId: "0.0.123", brokerUaid: "uaid:aid:broker" });
  });

  it("requests Ledger funding and resolves the Spend Account automatically", async () => {
    const { ui, messages } = fakeUi();
    let seenAmount = "";
    let seenDestination = "";
    const result = await runSetupWizard(baseDeps({
      ui,
      fundingAmountTinybar: "2200000000",
      fundBroker: async ({ brokerAddress, amountTinybar, confirm }) => {
        seenAmount = amountTinybar;
        seenDestination = brokerAddress;
        expect(await confirm({ principalAddress: `0x${"33".repeat(20)}`, brokerAddress, amountTinybar, maxFeeTinybar: "100" })).toBe(true);
        return { principalAddress: `0x${"33".repeat(20)}`, transactionHash: `0x${"44".repeat(32)}` };
      },
      resolveHederaAccountId: async (address) => {
        expect(address).toBe(seenDestination);
        return "0.0.456";
      },
    }));
    expect(result).toMatchObject({ ok: true, spendAccountId: "0.0.456" });
    expect(seenAmount).toBe("2200000000");
    expect(messages).toContain("Ledger payment confirmed. Resolving the new Hedera Spend Account...");
  });

  it("reuses a valid existing Broker Bundle without requesting another Ledger payment", async () => {
    const bundlesDir = mkdtempSync(join(tmpdir(), "finity-existing-setup-"));
    const identityPath = join(bundlesDir, "identity.json");
    mkdirSync(bundlesDir, { recursive: true });
    writeFileSync(join(bundlesDir, "broker.enc"), "ciphertext");
    writeFileSync(identityPath, JSON.stringify({ broker: { uaid: "uaid:aid:broker", canonical: { registry: "finity", name: "finity-broker", version: "1", protocol: "finity/1", nativeId: "hedera:testnet:0.0.123", skills: [] }, canonicalJson: "{}" } }));
    let funded = false;
    let generated = false;
    const result = await runSetupWizard(baseDeps({
      bundlesDir,
      identityPath,
      ringReady: async () => true,
      generateBrokerSessionKey: () => { generated = true; return { brokerSessionKey: `0x${"11".repeat(32)}`, brokerAddress: `0x${"22".repeat(20)}` }; },
      fundBroker: async () => { funded = true; throw new Error("must not fund"); },
    }));
    expect(result).toEqual({ ok: true, spendAccountId: "0.0.123", brokerUaid: "uaid:aid:broker" });
    expect(funded).toBe(false);
    expect(generated).toBe(false);
  });

  it("aborts before ring init when the genuine check fails", async () => {
    let ringInitCalled = false;
    const result = await runSetupWizard(baseDeps({ genuineCheck: async () => false, ringInit: async () => { ringInitCalled = true; return true; } }));
    expect(result).toEqual({ ok: false, reason: "GENUINE_CHECK_FAILED" });
    expect(ringInitCalled).toBe(false);
  });

  it("reuses an initialized Key Ring without calling ring init again", async () => {
    let ringInitCalled = false;
    const { ui, messages } = fakeUi();
    const result = await runSetupWizard(baseDeps({
      ui,
      ringReady: async () => true,
      ringInit: async () => { ringInitCalled = true; return false; },
    }));
    expect(result.ok).toBe(true);
    expect(ringInitCalled).toBe(false);
    expect(messages).toContain("Ledger Key Ring is already initialized. Reusing it.");
  });

  it("stages and verifies a replacement before activating the broker bundle", async () => {
    let sealedPath = "";
    let verifiedPath = "";
    let moved: { source: string; destination: string } | undefined;
    const deps = baseDeps({
      sealBrokerBundle: async ({ outputPath }) => { sealedPath = outputPath; },
      verifyBrokerBundleRecovery: async ({ bundlePath }) => { verifiedPath = bundlePath; return true; },
      moveBundle: async (source, destination) => { moved = { source, destination }; },
    });
    const result = await runSetupWizard(deps);
    expect(result.ok).toBe(true);
    expect(sealedPath).toMatch(/\.broker\.enc\.[^/]+\.tmp$/);
    expect(verifiedPath).toBe(sealedPath);
    expect(moved).toEqual({ source: sealedPath, destination: join(deps.bundlesDir, "broker.enc") });
  });

  it("aborts before sealing when ring init fails", async () => {
    let sealed = false;
    const result = await runSetupWizard(baseDeps({ ringInit: async () => false, sealBrokerBundle: async () => { sealed = true; } }));
    expect(result).toEqual({ ok: false, reason: "RING_INIT_FAILED" });
    expect(sealed).toBe(false);
  });

  it("aborts without sealing anything when no funding amount is provided", async () => {
    let sealed = false;
    const ui = { notify: () => {}, confirm: async () => true, input: async () => undefined };
    const result = await runSetupWizard(baseDeps({ ui, fundingAmountTinybar: undefined, getFundingAmount: async () => undefined, sealBrokerBundle: async () => { sealed = true; } }));
    expect(result).toEqual({ ok: false, reason: "INVALID_FUNDING_AMOUNT" });
    expect(sealed).toBe(false);
  });

  it("fails closed when the funded alias cannot be resolved", async () => {
    const result = await runSetupWizard(baseDeps({ resolveHederaAccountId: async () => { throw new Error("mirror unavailable"); } }));
    expect(result).toEqual({ ok: false, reason: "ACCOUNT_RESOLUTION_FAILED" });
  });

  it("never saves identity.json when the recovery test fails", async () => {
    let saved = false;
    const result = await runSetupWizard(baseDeps({ verifyBrokerBundleRecovery: async () => false, saveIdentityFile: async () => { saved = true; } }));
    expect(result).toEqual({ ok: false, reason: "RECOVERY_FAILED" });
    expect(saved).toBe(false);
  });
});
