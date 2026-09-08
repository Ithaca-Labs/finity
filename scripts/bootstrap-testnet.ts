import { execFile as execFileCallback } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";
import {
  AccountCreateTransaction,
  Client,
  Hbar,
  PrivateKey,
} from "@hiero-ledger/sdk";
import { generateIdentity, saveIdentityFile, sealBrokerBundle, verifyBrokerBundleRecovery } from "@finity/pi-package";
import { createHcsWriter, hederaTestnetChain } from "@finity/registry-client";
import { http, createPublicClient, createWalletClient, type Abi, type Address, type Hex } from "viem";
import { deployContract } from "viem/actions";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const execFile = promisify(execFileCallback);
const RPC_URL = process.env.FINITY_RPC_URL ?? "https://testnet.hashio.io/api";
const MIRROR_URL = process.env.FINITY_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";
const ENV_PATH = `${process.cwd()}/.env`;

type EnvValues = Record<string, string>;
type ProvisionedAccount = {
  accountId: string;
  evmAddress: Address;
  transactionId?: string;
  privateKey: `0x${string}`;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseEnv(source: string): EnvValues {
  const values: EnvValues = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^(?:export )?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const raw = match[2] ?? "";
    values[match[1]!] = raw.replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

async function loadLocalEnv(): Promise<EnvValues> {
  let source = "";
  try {
    source = await readFile(ENV_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const values = parseEnv(source);
  for (const [name, value] of Object.entries(values)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
  return values;
}

async function persistEnv(values: EnvValues): Promise<void> {
  let source = "";
  try {
    source = await readFile(ENV_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const seen = new Set<string>();
  const lines = source.split(/\r?\n/).map((line) => {
    const match = /^(?:export )?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || values[match[1]!] === undefined) return line;
    seen.add(match[1]!);
    return `${match[1]}=${values[match[1]!]}`;
  });
  for (const [name, value] of Object.entries(values)) {
    if (!seen.has(name)) lines.push(`${name}=${value}`);
    process.env[name] = value;
  }
  await writeFile(ENV_PATH, `${lines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
  await chmod(ENV_PATH, 0o600);
}

function rawHederaKey(privateKey: `0x${string}`): PrivateKey {
  return PrivateKey.fromStringECDSA(privateKey.slice(2));
}

async function createAccount(
  client: Client,
  label: string,
  privateKey: `0x${string}`,
  initialHbar: string,
): Promise<ProvisionedAccount> {
  const evmAddress = privateKeyToAccount(privateKey).address;
  const hederaKey = rawHederaKey(privateKey);
  if (`0x${hederaKey.publicKey.toEvmAddress()}`.toLowerCase() !== evmAddress.toLowerCase()) {
    throw new Error(`${label} ECDSA key/address mismatch`);
  }
  const response = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(hederaKey)
    .setInitialBalance(new Hbar(initialHbar))
    .setAccountMemo(`Finity ${label}`)
    .execute(client);
  const receipt = await response.getReceipt(client);
  if (!receipt.accountId) throw new Error(`${label} account creation returned no account ID`);
  return {
    accountId: receipt.accountId.toString(),
    evmAddress,
    transactionId: response.transactionId.toString(),
    privateKey,
  };
}

async function accountFromEnv(
  client: Client,
  values: EnvValues,
  idName: string,
  keyName: string,
  addressName: string,
  label: string,
  initialHbar: string,
): Promise<ProvisionedAccount> {
  const privateKey = (values[keyName] ?? generatePrivateKey()) as `0x${string}`;
  const evmAddress = privateKeyToAccount(privateKey).address;
  const accountId = values[idName];
  if (accountId) return { accountId, evmAddress, privateKey };
  const account = await createAccount(client, label, privateKey, initialHbar);
  await persistEnv({ [keyName]: privateKey, [addressName]: account.evmAddress, [idName]: account.accountId });
  return account;
}

async function deployRegistry(values: EnvValues, broker: ProvisionedAccount): Promise<{ address: Address; transactionId: Hex }> {
  if (values.FINITY_REGISTRY_ADDRESS) {
    return { address: values.FINITY_REGISTRY_ADDRESS as Address, transactionId: "0x" as Hex };
  }
  const artifactPath = `${process.cwd()}/contracts/artifacts/contracts/MandateRegistry.sol/MandateRegistry.json`;
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as { abi: Abi; bytecode: string };
  const account = privateKeyToAccount(broker.privateKey);
  const wallet = createWalletClient({ account, chain: hederaTestnetChain, transport: http(RPC_URL) });
  const publicClient = createPublicClient({ chain: hederaTestnetChain, transport: http(RPC_URL) });
  const transactionId = await deployContract(wallet, {
    account,
    chain: hederaTestnetChain,
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionId });
  if (!receipt.contractAddress) throw new Error("MandateRegistry deployment returned no contract address");
  await persistEnv({ FINITY_REGISTRY_ADDRESS: receipt.contractAddress, HEDERA_RPC_URL: RPC_URL });
  return { address: receipt.contractAddress, transactionId };
}

async function createRegistryTopic(values: EnvValues, operator: { id: string; key: string }): Promise<{ topicId: string; transactionId: string }> {
  if (values.FINITY_REGISTRY_TOPIC_ID) return { topicId: values.FINITY_REGISTRY_TOPIC_ID, transactionId: "" };
  const writer = createHcsWriter({ network: "hedera:testnet", operatorId: operator.id, privateKey: operator.key });
  try {
    const topic = await writer.createTopic("Finity Service Registry v1");
    await persistEnv({ FINITY_REGISTRY_TOPIC_ID: topic.topicId });
    return topic;
  } finally {
    writer.close();
  }
}

async function keychainPassword(): Promise<string> {
  const result = await execFile("security", ["find-generic-password", "-a", "default", "-s", "ledger-wallet-cli", "-w"], {
    encoding: "utf8",
  });
  const password = result.stdout.trim();
  if (!password) throw new Error("macOS Keychain returned an empty Ledger wallet password");
  return password;
}

async function main(): Promise<void> {
  if (process.env.FINITY_TESTNET !== "1") {
    throw new Error("refusing testnet writes: run with FINITY_TESTNET=1 after reviewing this command");
  }
  const values = await loadLocalEnv();
  const operatorId = required("HEDERA_OPERATOR_ID");
  const operatorKey = required("HEDERA_OPERATOR_KEY");
  const client = Client.forTestnet();
  client.setOperator(operatorId, operatorKey);

  const broker = await accountFromEnv(client, values, "FINITY_SPEND_ACCOUNT_ID", "FINITY_BROKER_SESSION_KEY", "FINITY_BROKER_EVM_ADDRESS", "broker", "50");

  const providerA = await accountFromEnv(client, values, "FINITY_PROVIDER_A_ACCOUNT", "FINITY_PROVIDER_A_SIGNING_EVM_PRIVATE_KEY", "FINITY_PROVIDER_A_EVM_ADDRESS", "provider A", "10");
  const providerB = await accountFromEnv(client, values, "FINITY_PROVIDER_B_ACCOUNT", "FINITY_PROVIDER_B_SIGNING_EVM_PRIVATE_KEY", "FINITY_PROVIDER_B_EVM_ADDRESS", "provider B", "10");
  await persistEnv({
    FINITY_PROVIDER_A_URL: values.FINITY_PROVIDER_A_URL ?? "http://127.0.0.1:3001",
    FINITY_PROVIDER_B_URL: values.FINITY_PROVIDER_B_URL ?? "http://127.0.0.1:3002",
    FINITY_PROVIDER_A_PORT: values.FINITY_PROVIDER_A_PORT ?? "3001",
    FINITY_PROVIDER_B_PORT: values.FINITY_PROVIDER_B_PORT ?? "3002",
    FINITY_FACILITATOR_URL: values.FINITY_FACILITATOR_URL ?? "https://api.testnet.blocky402.com",
    FINITY_MIRROR_NODE_URL: values.FINITY_MIRROR_NODE_URL ?? MIRROR_URL,
    FINITY_RPC_URL: values.FINITY_RPC_URL ?? RPC_URL,
    FINITY_PRINCIPAL_FUNDING_ACCOUNT: values.FINITY_PRINCIPAL_FUNDING_ACCOUNT ?? operatorId,
    FINITY_PROVIDER_A_ACCOUNT: providerA.accountId,
    FINITY_PROVIDER_B_ACCOUNT: providerB.accountId,
    FINITY_PROVIDER_A_SIGNING_EVM_PRIVATE_KEY: providerA.privateKey,
    FINITY_PROVIDER_B_SIGNING_EVM_PRIVATE_KEY: providerB.privateKey,
    FINITY_BROKER_SESSION_KEY: broker.privateKey,
    FINITY_BROKER_EVM_ADDRESS: broker.evmAddress,
    FINITY_SPEND_ACCOUNT_ID: broker.accountId,
  });

  const deployment = await deployRegistry(values, broker);
  const topic = await createRegistryTopic(values, { id: operatorId, key: operatorKey });
  const brokerIdentity = await generateIdentity({ name: "finity-broker", nativeId: `hedera:testnet:${broker.accountId}` });
  const home = process.env.FINITY_HOME ?? `${homedir()}/.finity`;
  const bundlePath = `${home}/bundles/broker.enc`;
  await sealBrokerBundle({
    brokerId: "default",
    bundle: { brokerSessionKey: broker.privateKey, spendAccountId: broker.accountId, brokerUaid: brokerIdentity.uaid },
    outputPath: bundlePath,
    walletPass: keychainPassword,
  });
  if (!(await verifyBrokerBundleRecovery({ brokerId: "default", bundlePath, walletPass: keychainPassword }))) {
    throw new Error("sealed Broker Bundle failed its recovery check");
  }
  await saveIdentityFile(`${home}/identity.json`, { broker: brokerIdentity });
  await persistEnv({ FINITY_REGISTRY_ADDRESS: deployment.address, FINITY_REGISTRY_TOPIC_ID: topic.topicId });

  console.log(JSON.stringify({
    operatorId,
    broker: { accountId: broker.accountId, evmAddress: broker.evmAddress, accountCreationTx: broker.transactionId },
    providers: {
      A: { accountId: providerA.accountId, evmAddress: providerA.evmAddress, accountCreationTx: providerA.transactionId },
      B: { accountId: providerB.accountId, evmAddress: providerB.evmAddress, accountCreationTx: providerB.transactionId },
    },
    registry: { address: deployment.address, deploymentTx: deployment.transactionId },
    serviceRegistry: { topicId: topic.topicId, topicCreationTx: topic.transactionId },
    local: { providerA: "http://127.0.0.1:3001", providerB: "http://127.0.0.1:3002", rpc: RPC_URL, mirror: MIRROR_URL },
    sealedBundle: "~/.finity/bundles/broker.enc",
  }, null, 2));
  client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
