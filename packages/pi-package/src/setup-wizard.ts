import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { WalletPassProvider } from "@therick/vault-worker";
import type { BrokerBundle } from "@therick/schemas";
import { generateBrokerSessionKey as defaultGenerateBrokerSessionKey, sealBrokerBundle as defaultSealBrokerBundle, verifyBrokerBundleRecovery as defaultVerifyBrokerBundleRecovery } from "./broker-bundle.js";
import { fundBrokerFromLedger as defaultFundBrokerFromLedger, resolveHederaAccountId as defaultResolveHederaAccountId } from "./ledger-funding.js";
import { generateIdentity as defaultGenerateIdentity, loadIdentityFile as defaultLoadIdentityFile, saveIdentityFile as defaultSaveIdentityFile, type Identity } from "./identity.js";
import { formatAddress, formatTinybars } from "./finity-tui.js";
import { validateFundingAmountTinybar } from "./setup-funding.js";

export type WizardUI = {
  notify(message: string, kind?: "info" | "error" | "success"): void;
  confirm(title: string, message: string): Promise<boolean>;
  input(title: string, message: string): Promise<string | undefined>;
};

export type SetupWizardDeps = {
  ui: WizardUI;
  genuineCheck(): Promise<boolean>;
  ringReady?: () => Promise<boolean>;
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
  moveBundle?: (source: string, destination: string) => Promise<void>;
  fundingAmountTinybar?: string;
  getFundingAmount?: () => Promise<string | undefined>;
  fundBroker?: typeof defaultFundBrokerFromLedger;
  resolveHederaAccountId?: typeof defaultResolveHederaAccountId;
  rpcUrl?: string;
  mirrorNodeUrl?: string;
  derivationPath?: string;
};

export type SetupWizardResult =
  | { ok: true; brokerAddress?: `0x${string}`; spendAccountId: string; brokerUaid: string }
  | { ok: false; reason: string };

async function existingBrokerBundlePath(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function reuseExistingSetup(
  deps: SetupWizardDeps,
  bundlePath: string,
  verifyBrokerBundleRecovery: typeof defaultVerifyBrokerBundleRecovery,
): Promise<SetupWizardResult | undefined> {
  if (!(await existingBrokerBundlePath(bundlePath))) return undefined;

  let identity: Awaited<ReturnType<typeof defaultLoadIdentityFile>>;
  try {
    identity = await defaultLoadIdentityFile(deps.identityPath);
  } catch {
    deps.ui.notify("Existing broker setup is unreadable. No new Ledger payment was requested.", "error");
    return { ok: false, reason: "EXISTING_BROKER_INVALID" };
  }
  const spendAccountId = identity?.broker?.canonical.nativeId.match(/^hedera:testnet:(0\.0\.[1-9][0-9]*)$/)?.[1];
  if (!identity?.broker || !spendAccountId) {
    deps.ui.notify("Existing broker setup is missing a valid Hedera Spend Account. No new Ledger payment was requested.", "error");
    return { ok: false, reason: "EXISTING_BROKER_INVALID" };
  }

  let recovered = false;
  try {
    recovered = await verifyBrokerBundleRecovery({ brokerId: deps.brokerId, bundlePath, walletPass: deps.walletPass });
  } catch {
    // Do not overwrite a bundle that cannot be recovered. The password or
    // Key Ring may be temporarily unavailable; setup must fail closed.
  }
  if (!recovered) {
    deps.ui.notify("Existing Broker Bundle could not be recovered. Check WALLET_PASS and the Ledger Key Ring, then retry.", "error");
    return { ok: false, reason: "EXISTING_BROKER_INVALID" };
  }

  deps.ui.notify(`Existing Finity broker detected for Spend Account ${spendAccountId}. Reusing it; no Ledger payment is needed.`, "success");
  return { ok: true, spendAccountId, brokerUaid: identity.broker.uaid };
}

/**
 * `/finity setup` (FINITY_BUILD_SPEC.md step 14): genuine-check, ring init,
 * generate the Broker Session Key, request Ledger funding for the Spend Account, seal the Broker
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
  const moveBundle = deps.moveBundle ?? rename;

  deps.ui.notify("Checking your Ledger is genuine...");
  if (!(await deps.genuineCheck())) {
    deps.ui.notify("Genuine check failed. Aborting setup - do not proceed with an unverified device.", "error");
    return { ok: false, reason: "GENUINE_CHECK_FAILED" };
  }

  const keyRingReady = deps.ringReady ? await deps.ringReady() : false;
  if (keyRingReady) {
    deps.ui.notify("Ledger Key Ring is already initialized. Reusing it.", "info");
  } else {
    deps.ui.notify("Initializing your Ledger Key Ring. This needs your device and the password you've already set in WALLET_PASS.", "info");
    if (!(await deps.ringInit(deps.hostname))) {
      deps.ui.notify("Key Ring initialization failed. Aborting setup.", "error");
      return { ok: false, reason: "RING_INIT_FAILED" };
    }
  }

  const bundlePath = join(deps.bundlesDir, "broker.enc");
  const existing = await reuseExistingSetup(deps, bundlePath, verifyBrokerBundleRecovery);
  if (existing) return existing;

  const { brokerSessionKey, brokerAddress } = generateBrokerSessionKey();

  let fundingAmountTinybar: string | undefined;
  try {
    fundingAmountTinybar = validateFundingAmountTinybar(deps.fundingAmountTinybar ?? await deps.getFundingAmount?.() ?? "");
  } catch {
    deps.ui.notify("Setup cancelled: choose a positive initial HBAR funding amount.", "error");
    return { ok: false, reason: "INVALID_FUNDING_AMOUNT" };
  }

  const fundBroker = deps.fundBroker ?? defaultFundBrokerFromLedger;
  const resolveHederaAccountId = deps.resolveHederaAccountId ?? defaultResolveHederaAccountId;
  deps.ui.notify(`Requesting ${formatTinybars(fundingAmountTinybar)} from your Ledger wallet for the new Spend Account.`, "info");
  let funding: Awaited<ReturnType<typeof defaultFundBrokerFromLedger>>;
  try {
    funding = await fundBroker({
      brokerAddress,
      amountTinybar: fundingAmountTinybar,
      rpcUrl: deps.rpcUrl,
      derivationPath: deps.derivationPath ?? "44'/60'/0'/0/0",
      confirm: ({ principalAddress, brokerAddress: destination, amountTinybar, maxFeeTinybar }) => deps.ui.confirm(
        "Fund Finity from Ledger",
        `Request ${formatTinybars(amountTinybar)} from Ledger ${formatAddress(principalAddress)} to the new Spend Account ${formatAddress(destination)}. Estimated maximum network fee: ${formatTinybars(maxFeeTinybar)}. Approve the transfer on your Ledger?`,
      ),
    });
  } catch (error) {
    const cancelled = error instanceof Error && /cancelled/i.test(error.message);
    deps.ui.notify(cancelled ? "Ledger funding cancelled. No broker bundle was activated." : "Ledger funding failed. Check the device and Hedera testnet balance, then retry.", "error");
    return { ok: false, reason: cancelled ? "FUNDING_CANCELLED" : "FUNDING_FAILED" };
  }

  deps.ui.notify("Ledger payment confirmed. Resolving the new Hedera Spend Account...", "info");
  let spendAccountId: string;
  try {
    spendAccountId = await resolveHederaAccountId(brokerAddress, { mirrorNodeUrl: deps.mirrorNodeUrl });
  } catch {
    deps.ui.notify(`Ledger payment succeeded (${funding.transactionHash}), but the new Spend Account is not visible on the mirror yet. Retry setup after a short wait; do not fund another address.`, "error");
    return { ok: false, reason: "ACCOUNT_RESOLUTION_FAILED" };
  }

  let brokerIdentity: Identity;
  try {
    brokerIdentity = await generateIdentity({ name: "finity-broker", nativeId: `hedera:testnet:${spendAccountId}` });
  } catch (error) {
    deps.ui.notify(`Failed to generate the broker's HCS-14 identity: ${(error as Error).message}`, "error");
    return { ok: false, reason: "IDENTITY_FAILED" };
  }

  const bundle: BrokerBundle = { brokerSessionKey, spendAccountId, brokerUaid: brokerIdentity.uaid };
  const stagedBundlePath = join(deps.bundlesDir, `.broker.enc.${randomUUID()}.tmp`);
  await mkdir(deps.bundlesDir, { recursive: true });
  try {
    await sealBrokerBundle({ brokerId: deps.brokerId, bundle, outputPath: stagedBundlePath, walletPass: deps.walletPass });
  } catch (error) {
    await rm(stagedBundlePath, { force: true }).catch(() => undefined);
    deps.ui.notify(`Failed to seal the Broker Bundle: ${(error as Error).message}`, "error");
    return { ok: false, reason: "SEAL_FAILED" };
  }

  deps.ui.notify("Verifying the sealed bundle can be recovered before calling the broker active...");
  let recovered: boolean;
  try {
    recovered = await verifyBrokerBundleRecovery({ brokerId: deps.brokerId, bundlePath: stagedBundlePath, walletPass: deps.walletPass });
  } catch (error) {
    await rm(stagedBundlePath, { force: true }).catch(() => undefined);
    deps.ui.notify(`Recovery test errored: ${(error as Error).message}`, "error");
    return { ok: false, reason: "RECOVERY_FAILED" };
  }
  if (!recovered) {
    await rm(stagedBundlePath, { force: true }).catch(() => undefined);
    deps.ui.notify("Recovery test failed: the sealed bundle did not decrypt back to the expected shape.", "error");
    return { ok: false, reason: "RECOVERY_FAILED" };
  }

  try {
    await moveBundle(stagedBundlePath, bundlePath);
  } catch (error) {
    await rm(stagedBundlePath, { force: true }).catch(() => undefined);
    deps.ui.notify(`Failed to activate the Broker Bundle: ${(error as Error).message}`, "error");
    return { ok: false, reason: "SEAL_FAILED" };
  }

  await saveIdentityFile(deps.identityPath, { broker: brokerIdentity });
  deps.ui.notify(`Setup complete. Broker address ${brokerAddress}; Spend Account ${spendAccountId}.`, "success");
  return { ok: true, brokerAddress, spendAccountId, brokerUaid: brokerIdentity.uaid };
}
