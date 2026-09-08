import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { registerMandateOnChain, signTypedDataOnDevice, generateIdentity, loadIdentityFile, saveActiveMandate } from "@finity/pi-package";
import { compile, type MandateChoices } from "@finity/mandate-compiler";
import { POLICY_HASH } from "@finity/policy-engine";
import { createHcsWriter, createRegistryClient } from "@finity/registry-client";
import { signedAgentMandateSchema } from "@finity/schemas";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function finityHome(): string {
  return process.env.FINITY_HOME ?? join(homedir(), ".finity");
}

async function loadEnvFile(): Promise<void> {
  let source = "";
  try {
    source = await readFile(join(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const line of source.split(/\r?\n/)) {
    const match = /^(?:export )?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]!] !== undefined) continue;
    process.env[match[1]!] = (match[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function main(): Promise<void> {
  await loadEnvFile();
  if (process.env.FINITY_TESTNET !== "1") {
    throw new Error("refusing Ledger signing and registry writes: run with FINITY_TESTNET=1 after reviewing the mandate");
  }
  const home = finityHome();
  const identity = await loadIdentityFile(join(home, "identity.json"));
  if (!identity?.broker) throw new Error("broker identity is missing; run pnpm testnet:bootstrap first");
  const registryAddress = required("FINITY_REGISTRY_ADDRESS") as `0x${string}`;
  const brokerAddress = required("FINITY_BROKER_EVM_ADDRESS") as `0x${string}`;
  const spendAccountId = required("FINITY_SPEND_ACCOUNT_ID");
  const now = Math.floor(Date.now() / 1000);
  const fixture = JSON.parse(await readFile(join(process.cwd(), "fixtures/mandate-weather.json"), "utf8")) as Record<string, unknown>;
  const agentIdentity = await generateIdentity({ name: "finity-buyer", nativeId: identity.broker.canonical.nativeId, uid: "buyer" });
  const choices = {
    ...fixture,
    agent: agentIdentity.uaid,
    broker: brokerAddress,
    spendAccount: spendAccountId,
    policyHash: POLICY_HASH,
    validFrom: now - 60,
    validUntil: now + 365 * 24 * 60 * 60,
    verifyingContract: registryAddress,
  } as unknown as MandateChoices;
  const compiled = compile(choices);
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "mandate-draft.json"), `${JSON.stringify(compiled.canonicalMandate, null, 2)}\n`, { mode: 0o600 });

  console.error("Review the mandate fields on the Ledger Ethereum app and approve the EIP-712 signature when prompted.");
  const signature = await signTypedDataOnDevice({
    derivationPath: "44'/60'/0'/0/0",
    typedData: { ...compiled.typedData, types: { AgentMandate: [...compiled.typedData.types.AgentMandate] } },
  });
  const rawRegistry = createRegistryClient({
    contractAddress: registryAddress,
    rpcUrl: process.env.FINITY_RPC_URL,
    privateKey: required("FINITY_BROKER_SESSION_KEY") as `0x${string}`,
  });
  const registryClient = {
    registerMandate: async (mandate: Parameters<typeof rawRegistry.registerMandate>[0], signed: string) => {
      const transactionId = await rawRegistry.registerMandate(mandate, signed);
      await rawRegistry.publicClient.waitForTransactionReceipt({ hash: transactionId });
      return transactionId;
    },
    setTraceTopic: async (mandateId: Parameters<typeof rawRegistry.setTraceTopic>[0], topicId: string) => {
      const transactionId = await rawRegistry.setTraceTopic(mandateId, topicId);
      await rawRegistry.publicClient.waitForTransactionReceipt({ hash: transactionId });
      return transactionId;
    },
  };
  const hcsWriter = createHcsWriter({
    network: "hedera:testnet",
    operatorId: required("HEDERA_OPERATOR_ID"),
    privateKey: required("HEDERA_OPERATOR_KEY"),
  });
  try {
    const registered = await registerMandateOnChain({
      choices,
      registryClient,
      sign: async () => signature,
      createTraceTopic: (memo) => hcsWriter.createTopic(memo),
      onProgress: (stage) => console.error({
        signature_received: "Ledger signature received; registering the mandate on Hedera...",
        mandate_registered: "Mandate registered; creating the HCS trace topic...",
        trace_topic_created: "Trace topic created; binding it to the mandate...",
        trace_topic_bound: "Mandate registration complete.",
      }[stage]),
    });
    const parsed = signedAgentMandateSchema.parse(registered.signedMandate);
    await mkdir(join(home, "mandates"), { recursive: true });
    await writeFile(join(home, "mandates", `${registered.mandateId}.json`), `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    await saveActiveMandate(join(home, "active-mandate.json"), {
      mandateId: registered.mandateId,
      agentUaid: agentIdentity.uaid,
      brokerUaid: identity.broker.uaid,
    });
    await writeFile(join(home, "identity.json"), `${JSON.stringify({ ...identity, agent: agentIdentity }, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({
      mandateId: registered.mandateId,
      registrationTx: registered.registrationTx,
      traceTopicId: registered.traceTopicId,
      traceTopicTx: registered.traceTopicTx,
      setTraceTopicTx: registered.setTraceTopicTx,
      agentUaid: agentIdentity.uaid,
    }, null, 2));
  } finally {
    hcsWriter.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
