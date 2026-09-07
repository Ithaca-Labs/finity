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
  return {
    ui,
    genuineCheck: async () => true,
    ringInit: async () => true,
    walletPass: async () => "throwaway-test-password",
    bundlesDir: "/tmp/finity-bundles",
    identityPath: "/tmp/finity-identity.json",
    brokerId: "default",
    hostname: "test-host",
    generateBrokerSessionKey: () => ({ brokerSessionKey: `0x${"11".repeat(32)}`, brokerAddress: `0x${"22".repeat(20)}` }),
    generateIdentity: async () => ({ uaid: "uaid:aid:broker", canonical: { registry: "finity", name: "finity-broker", version: "1", protocol: "finity/1", nativeId: "hedera:testnet:0.0.123", skills: [] }, canonicalJson: "{}" }),
    sealBrokerBundle: async () => undefined,
    verifyBrokerBundleRecovery: async () => true,
    saveIdentityFile: async () => undefined,
    ...overrides,
  };
}

describe("runSetupWizard", () => {
  it("completes the full happy path and returns the broker's address and Spend Account", async () => {
    const result = await runSetupWizard(baseDeps());
    expect(result).toEqual({ ok: true, brokerAddress: `0x${"22".repeat(20)}`, spendAccountId: "0.0.123", brokerUaid: "uaid:aid:broker" });
  });

  it("aborts before ring init when the genuine check fails", async () => {
    let ringInitCalled = false;
    const result = await runSetupWizard(baseDeps({ genuineCheck: async () => false, ringInit: async () => { ringInitCalled = true; return true; } }));
    expect(result).toEqual({ ok: false, reason: "GENUINE_CHECK_FAILED" });
    expect(ringInitCalled).toBe(false);
  });

  it("aborts before sealing when ring init fails", async () => {
    let sealed = false;
    const result = await runSetupWizard(baseDeps({ ringInit: async () => false, sealBrokerBundle: async () => { sealed = true; } }));
    expect(result).toEqual({ ok: false, reason: "RING_INIT_FAILED" });
    expect(sealed).toBe(false);
  });

  it("aborts without sealing anything when no Spend Account ID is provided", async () => {
    let sealed = false;
    const ui = { notify: () => {}, confirm: async () => true, input: async () => undefined };
    const result = await runSetupWizard(baseDeps({ ui, sealBrokerBundle: async () => { sealed = true; } }));
    expect(result).toEqual({ ok: false, reason: "NO_SPEND_ACCOUNT" });
    expect(sealed).toBe(false);
  });

  it("never saves identity.json when the recovery test fails", async () => {
    let saved = false;
    const result = await runSetupWizard(baseDeps({ verifyBrokerBundleRecovery: async () => false, saveIdentityFile: async () => { saved = true; } }));
    expect(result).toEqual({ ok: false, reason: "RECOVERY_FAILED" });
    expect(saved).toBe(false);
  });
});
