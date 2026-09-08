import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { compile, MANDATE_DERIVATION_PATH } from "@finity/mandate-compiler";
import { discover, quote } from "@finity/negotiator";
import { POLICY_HASH } from "@finity/policy-engine";
import { createRegistryClient } from "@finity/registry-client";
import type { RequestClass, SignedAgentMandate } from "@finity/schemas";
import {
  generateBrokerSessionKey, recoverBrokerBundle, recoverPendingBrokerBundle, sealBrokerBundle,
  sealPendingBrokerBundle, verifyBrokerBundleRecovery,
} from "./broker-bundle.js";
import { FinitydClient, loadFinitydRuntimeInfo } from "./finityd-client.js";
import { generateIdentity, loadIdentityFile, saveIdentityFile } from "./identity.js";
import { fundBrokerFromLedger, resolveHederaAccountId } from "./ledger-funding.js";
import { signTypedDataOnDevice } from "./ledger.js";
import { loadOnboardingState, saveOnboardingState } from "./onboarding-state.js";
import { ensureReadyForPurchase, type BrokerState } from "./purchase-readiness.js";
import { saveActiveMandate } from "./active-mandate.js";
import { genuineCheck, ringInit, ringReady } from "./wallet-cli-ops.js";
import { ensureWalletPassEnvironment } from "./wallet-pass.js";
import type { WizardUI } from "./setup-wizard.js";

const FEE_RESERVE_TINYBAR = 200_000_000n;

export type InteractivePurchaseRequest = {
  serviceId: string;
  methodId: string;
  requestClass: RequestClass;
  payloadRef: string;
  dataClass: number;
  preferCheapest?: boolean;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function hbar(tinybar: string): string {
  const value = BigInt(tinybar);
  return `${value / 100_000_000n}.${(value % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "") || "0"} HBAR`;
}

async function startDaemon(daemonPath: string): Promise<FinitydClient> {
  try {
    const current = new FinitydClient(await loadFinitydRuntimeInfo());
    await current.health();
    return current;
  } catch {
    await ensureWalletPassEnvironment();
    const child = spawn(process.execPath, [daemonPath], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        const client = new FinitydClient(await loadFinitydRuntimeInfo());
        await client.health();
        return client;
      } catch {
        // Keep waiting until the bounded startup window expires.
      }
    }
    throw new Error("finityd did not become healthy after onboarding");
  }
}

export async function ensureInteractivePurchaseReady(input: {
  ui: WizardUI;
  request: InteractivePurchaseRequest;
  home: string;
  daemonPath: string;
}): Promise<{ client: FinitydClient; activeMandateId: string; agentUaid: string; quoteAmount: string; reusedBroker: boolean; reusedMandate: boolean }> {
  const registryAddress = required("FINITY_REGISTRY_ADDRESS") as `0x${string}`;
  const registryTopicId = required("FINITY_REGISTRY_TOPIC_ID");
  const mirrorNodeUrl = process.env.FINITY_MIRROR_NODE_URL;
  const now = Math.floor(Date.now() / 1000);
  const manifests = await discover(
    { allowedServices: input.request.serviceId, allowedMethods: input.request.methodId, serviceHint: input.request.serviceId },
    { topicId: registryTopicId, mirrorNodeUrl },
  );
  const manifest = manifests[0];
  if (!manifest) throw new Error(`No published Finity service ${input.request.serviceId} supports ${input.request.methodId}`);
  const offeredQuote = await quote(manifest, input.request.methodId, input.request.requestClass, { now });
  if (offeredQuote.asset !== "0.0.0" || offeredQuote.network !== "hedera:testnet") {
    throw new Error("interactive onboarding currently supports native HBAR on Hedera testnet only");
  }
  const walletPass = async () => ensureWalletPassEnvironment();
  let daemonClient: FinitydClient | undefined;

  const ready = await ensureReadyForPurchase({
    serviceId: input.request.serviceId,
    methodId: input.request.methodId,
    unit: input.request.requestClass.unit,
    units: input.request.requestClass.units,
    amount: offeredQuote.amount,
    dataClass: input.request.dataClass,
  }, {
    home: input.home,
    now: () => Math.floor(Date.now() / 1000),
    readMandateStatus: (mandateId) => createRegistryClient({ contractAddress: registryAddress, rpcUrl: process.env.FINITY_RPC_URL }).readStatus(mandateId),
    provisionBroker: async (): Promise<BrokerState> => {
      await ensureWalletPassEnvironment();
      await mkdir(join(input.home, "bundles"), { recursive: true });
      const statePath = join(input.home, "onboarding.json");
      const pendingPath = join(input.home, "bundles", "broker.pending.enc");
      const finalPath = join(input.home, "bundles", "broker.enc");
      let state = await loadOnboardingState(statePath);
      if (!state) {
        input.ui.notify("No reusable broker found. Checking Ledger and creating a fresh broker key.", "info");
        if (!(await genuineCheck())) throw new Error("Ledger genuine check failed");
        if (!(await ringReady()) && !(await ringInit(hostname()))) throw new Error("Ledger Key Ring initialization failed");
        const generated = generateBrokerSessionKey();
        await sealPendingBrokerBundle({
          brokerId: "default", outputPath: pendingPath, walletPass,
          bundle: { version: 1, brokerSessionKey: generated.brokerSessionKey, brokerAddress: generated.brokerAddress },
        });
        state = { version: 1, stage: "BROKER_SEALED", brokerAddress: generated.brokerAddress };
        await saveOnboardingState(statePath, state);
      }
      if (!state.fundingTxHash) {
        const fundingAmount = (BigInt(offeredQuote.amount) + FEE_RESERVE_TINYBAR).toString();
        input.ui.notify(`Broker key sealed. The Ledger account will fund ${hbar(fundingAmount)} to ${state.brokerAddress}.`, "info");
        const funded = await fundBrokerFromLedger({
          brokerAddress: state.brokerAddress as `0x${string}`,
          amountTinybar: fundingAmount,
          rpcUrl: process.env.FINITY_RPC_URL,
          derivationPath: MANDATE_DERIVATION_PATH,
          confirm: ({ principalAddress, brokerAddress, amountTinybar, maxFeeTinybar }) => input.ui.confirm(
            "Fund broker account",
            `Transfer ${hbar(amountTinybar)} from Ledger ${principalAddress} to broker ${brokerAddress}. Maximum estimated network fee: ${hbar(maxFeeTinybar)}. Approve the transaction on your Ledger?`,
          ),
        });
        state = { ...state, stage: "FUNDED", principalAddress: funded.principalAddress, fundingTxHash: funded.transactionHash };
        await saveOnboardingState(statePath, state);
      }
      const spendAccountId = state.spendAccountId ?? await resolveHederaAccountId(state.brokerAddress as `0x${string}`, { mirrorNodeUrl });
      const pending = await recoverPendingBrokerBundle({ brokerId: "default", bundlePath: pendingPath, walletPass });
      if (pending.brokerAddress.toLowerCase() !== state.brokerAddress.toLowerCase()) throw new Error("sealed broker key does not match onboarding state");
      const brokerIdentity = await generateIdentity({ name: "finity-broker", nativeId: `hedera:testnet:${spendAccountId}` });
      await sealBrokerBundle({
        brokerId: "default", outputPath: finalPath, walletPass,
        bundle: { brokerSessionKey: pending.brokerSessionKey, spendAccountId, brokerUaid: brokerIdentity.uaid },
      });
      if (!(await verifyBrokerBundleRecovery({ brokerId: "default", bundlePath: finalPath, walletPass }))) throw new Error("sealed Broker Bundle recovery test failed");
      await saveIdentityFile(join(input.home, "identity.json"), { broker: brokerIdentity });
      await saveOnboardingState(statePath, { ...state, stage: "BROKER_READY", spendAccountId });
      await rm(pendingPath, { force: true });
      input.ui.notify(`Broker ready on Hedera account ${spendAccountId}.`, "success");
      return { identity: brokerIdentity, bundlePath: finalPath, brokerAddress: state.brokerAddress as `0x${string}`, spendAccountId };
    },
    ensureDaemon: async () => { daemonClient = await startDaemon(input.daemonPath); },
    createMandate: async (broker) => {
      let brokerAddress = broker.brokerAddress;
      let spendAccountId = broker.spendAccountId;
      if (!brokerAddress || !spendAccountId) {
        const recovered = await recoverBrokerBundle({ brokerId: "default", bundlePath: broker.bundlePath, walletPass });
        brokerAddress = (await import("viem/accounts")).privateKeyToAccount(recovered.brokerSessionKey as `0x${string}`).address;
        spendAccountId = recovered.spendAccountId;
      }
      const identityFile = await loadIdentityFile(join(input.home, "identity.json"));
      const agentIdentity = await generateIdentity({ name: "finity-buyer", nativeId: broker.identity.canonical.nativeId, uid: "buyer" });
      const validFrom = Math.floor(Date.now() / 1000) - 30;
      const choices = {
        agent: agentIdentity.uaid, broker: brokerAddress, spendAccount: spendAccountId,
        allowedServices: input.request.serviceId, allowedMethods: input.request.methodId, asset: "HBAR" as const,
        maxPerRequest: offeredQuote.amount, maxPerPeriod: offeredQuote.amount, periodSeconds: "86400",
        maxLifetime: offeredQuote.amount, maxUnitsPerRequest: input.request.requestClass.units,
        validFrom, validUntil: validFrom + 3600, quoteMaxAgeSeconds: "60", dataClass: input.request.dataClass,
        escalationRule: "Ask Principal on Ledger for any increase", policyHash: POLICY_HASH,
        nonce: String(Date.now()), predecessor: `0x${"00".repeat(32)}`, verifyingContract: registryAddress,
      };
      const compiled = compile(choices);
      const approved = await input.ui.confirm(
        "Create purchase mandate",
        `Authorize ${input.request.serviceId}/${input.request.methodId} for one purchase up to ${hbar(offeredQuote.amount)}, valid for one hour? Review and approve the mandate on your Ledger.`,
      );
      if (!approved) throw new Error("mandate creation cancelled by user");
      const signature = await signTypedDataOnDevice({
        derivationPath: MANDATE_DERIVATION_PATH,
        typedData: { ...compiled.typedData, types: { AgentMandate: [...compiled.typedData.types.AgentMandate] } },
      });
      const signedMandate: SignedAgentMandate = { ...compiled.canonicalMandate, signature, mandateId: compiled.mandateId };
      input.ui.notify("Ledger signature received. Registering mandate through the broker.", "info");
      await daemonClient!.registerMandateOnChain(signedMandate);
      await mkdir(join(input.home, "mandates"), { recursive: true });
      await writeFile(join(input.home, "mandates", `${compiled.mandateId}.json`), `${JSON.stringify(signedMandate, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await saveIdentityFile(join(input.home, "identity.json"), { ...identityFile, broker: broker.identity, agent: agentIdentity });
      const active = { mandateId: compiled.mandateId, agentUaid: agentIdentity.uaid, brokerUaid: broker.identity.uaid };
      await saveActiveMandate(join(input.home, "active-mandate.json"), active);
      const statePath = join(input.home, "onboarding.json");
      const state = await loadOnboardingState(statePath);
      if (state) await saveOnboardingState(statePath, { ...state, stage: "MANDATE_READY" });
      input.ui.notify(`Mandate ${compiled.mandateId} is active.`, "success");
      return { active, mandate: signedMandate };
    },
  });
  return {
    client: daemonClient!, activeMandateId: ready.active.mandateId, agentUaid: ready.active.agentUaid,
    quoteAmount: offeredQuote.amount, reusedBroker: ready.reusedBroker, reusedMandate: ready.reusedMandate,
  };
}
