import { join } from "node:path";
import type { WalletPassProvider } from "@finity/vault-worker";
import type { BrokerBundle } from "@finity/schemas";
import { generateBrokerSessionKey as defaultGenerateBrokerSessionKey, sealBrokerBundle as defaultSealBrokerBundle, verifyBrokerBundleRecovery as defaultVerifyBrokerBundleRecovery } from "./broker-bundle.js";
import { generateIdentity as defaultGenerateIdentity, saveIdentityFile as defaultSaveIdentityFile, type Identity } from "./identity.js";

export type WizardUI = {
  notify(message: string, kind?: "info" | "error" | "success"): void;
  confirm(title: string, message: string): Promise<boolean>;
  input(title: string, message: string): Promise<string | undefined>;
};

export type SetupWizardDeps = {
  ui: WizardUI;
  genuineCheck(): Promise<boolean>;
  ringInit(name: string): Promise<boolean>;
  walletPass: WalletPassProvider;
  bundlesDir: string;
  identityPath: string;
  brokerId: string;
  hostname: string;
  generateBrokerSessionKey?: typeof defaultGenerateBrokerSessionKey;
  generateIdentity?: typeof defaultGenerateIdentity;
  sealBrokerBundle?: typeof defaultSealBrokerBundle;
  verifyBrokerBundleRecovery?: typeof defaultVerifyBrokerBundleRecovery;
  saveIdentityFile?: typeof defaultSaveIdentityFile;
};

export type SetupWizardResult =
  | { ok: true; brokerAddress: `0x${string}`; spendAccountId: string; brokerUaid: string }
  | { ok: false; reason: string };

/**
 * `/finity setup` (FINITY_BUILD_SPEC.md step 14): genuine-check, ring init,
 * generate the Broker Session Key, fund the Spend Account, seal the Broker
 * Bundle, and run the recovery test before the broker is considered active
 * (user story 5). WALLET_PASS is read from the environment by walletPass -
 * never asked for through ui.input, so it can never land in the session
 * transcript.
 */
export async function runSetupWizard(deps: SetupWizardDeps): Promise<SetupWizardResult> {
  const generateBrokerSessionKey = deps.generateBrokerSessionKey ?? defaultGenerateBrokerSessionKey;
  const generateIdentity = deps.generateIdentity ?? defaultGenerateIdentity;
  const sealBrokerBundle = deps.sealBrokerBundle ?? defaultSealBrokerBundle;
  const verifyBrokerBundleRecovery = deps.verifyBrokerBundleRecovery ?? defaultVerifyBrokerBundleRecovery;
  const saveIdentityFile = deps.saveIdentityFile ?? defaultSaveIdentityFile;

  deps.ui.notify("Checking your Ledger is genuine...");
  if (!(await deps.genuineCheck())) {
    deps.ui.notify("Genuine check failed. Aborting setup - do not proceed with an unverified device.", "error");
    return { ok: false, reason: "GENUINE_CHECK_FAILED" };
  }

  deps.ui.notify("Initializing your Ledger Key Ring. This needs your device and the password you've already set in WALLET_PASS.", "info");
  if (!(await deps.ringInit(deps.hostname))) {
    deps.ui.notify("Key Ring initialization failed. Aborting setup.", "error");
    return { ok: false, reason: "RING_INIT_FAILED" };
  }

  const { brokerSessionKey, brokerAddress } = generateBrokerSessionKey();
  deps.ui.notify(
    `Fund this address with HBAR (at least your mandate's lifetime cap plus a fee reserve) to create the Spend Account: ${brokerAddress}`,
  );
  const spendAccountId = await deps.ui.input(
    "Spend Account",
    "Once funded, look up the resulting Hedera account ID (0.0.x) on the mirror node and enter it here:",
  );
  if (!spendAccountId) {
    deps.ui.notify("Setup cancelled: no Spend Account ID was provided.", "error");
    return { ok: false, reason: "NO_SPEND_ACCOUNT" };
  }

  let brokerIdentity: Identity;
  try {
    brokerIdentity = await generateIdentity({ name: "finity-broker", nativeId: `hedera:testnet:${spendAccountId}` });
  } catch (error) {
    deps.ui.notify(`Failed to generate the broker's HCS-14 identity: ${(error as Error).message}`, "error");
    return { ok: false, reason: "IDENTITY_FAILED" };
  }

  const bundle: BrokerBundle = { brokerSessionKey, spendAccountId, brokerUaid: brokerIdentity.uaid };
  const bundlePath = join(deps.bundlesDir, "broker.enc");
  try {
    await sealBrokerBundle({ brokerId: deps.brokerId, bundle, outputPath: bundlePath, walletPass: deps.walletPass });
  } catch (error) {
    deps.ui.notify(`Failed to seal the Broker Bundle: ${(error as Error).message}`, "error");
    return { ok: false, reason: "SEAL_FAILED" };
  }

  deps.ui.notify("Verifying the sealed bundle can be recovered before calling the broker active...");
  let recovered: boolean;
  try {
    recovered = await verifyBrokerBundleRecovery({ brokerId: deps.brokerId, bundlePath, walletPass: deps.walletPass });
  } catch (error) {
    deps.ui.notify(`Recovery test errored: ${(error as Error).message}`, "error");
    return { ok: false, reason: "RECOVERY_FAILED" };
  }
  if (!recovered) {
    deps.ui.notify("Recovery test failed: the sealed bundle did not decrypt back to the expected shape.", "error");
    return { ok: false, reason: "RECOVERY_FAILED" };
  }

  await saveIdentityFile(deps.identityPath, { broker: brokerIdentity });
  deps.ui.notify(`Setup complete. Broker address ${brokerAddress}; Spend Account ${spendAccountId}.`, "success");
  return { ok: true, brokerAddress, spendAccountId, brokerUaid: brokerIdentity.uaid };
}
