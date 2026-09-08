import {
  agentMandateSchema,
  canonicalizeJson,
  hcsEnvelopeSchema,
  integerString,
  serviceManifestSchema,
  signature as signatureSchema,
  type AgentMandate,
  type HcsEnvelope,
  type ServiceManifest,
} from "@finity/schemas";
import {
  Client as HederaClient,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const mandateComponents = [
  { name: "agent", type: "string" },
  { name: "broker", type: "address" },
  { name: "spendAccount", type: "string" },
  { name: "allowedServices", type: "string" },
  { name: "allowedMethods", type: "string" },
  { name: "asset", type: "string" },
  { name: "maxPerRequest", type: "uint256" },
  { name: "maxPerRequestText", type: "string" },
  { name: "maxPerPeriod", type: "uint256" },
  { name: "maxPerPeriodText", type: "string" },
  { name: "periodSeconds", type: "uint256" },
  { name: "maxLifetime", type: "uint256" },
  { name: "maxLifetimeText", type: "string" },
  { name: "maxUnitsPerRequest", type: "uint256" },
  { name: "validFrom", type: "uint256" },
  { name: "validUntil", type: "uint256" },
  { name: "validUntilText", type: "string" },
  { name: "quoteMaxAgeSeconds", type: "uint256" },
  { name: "dataClass", type: "uint8" },
  { name: "escalationRule", type: "string" },
  { name: "policyHash", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "predecessor", type: "bytes32" },
] as const;

const limitsComponents = [
  { name: "maxPerRequest", type: "uint256" },
  { name: "maxPerPeriod", type: "uint256" },
  { name: "periodSeconds", type: "uint256" },
  { name: "maxLifetime", type: "uint256" },
  { name: "validFrom", type: "uint256" },
  { name: "validUntil", type: "uint256" },
] as const;

const recordComponents = [
  { name: "principal", type: "address" },
  { name: "broker", type: "address" },
  { name: "policyHash", type: "bytes32" },
  { name: "limits", type: "tuple", components: limitsComponents },
  { name: "lifetimeConsumed", type: "uint256" },
  { name: "periodIndex", type: "uint256" },
  { name: "periodConsumed", type: "uint256" },
  { name: "reserved", type: "uint256" },
  { name: "status", type: "uint8" },
  { name: "successor", type: "bytes32" },
  { name: "traceTopic", type: "string" },
] as const;

export const mandateRegistryAbi = [
  {
    type: "event",
    name: "ReservationCreated",
    inputs: [
      { name: "reservationId", type: "bytes32", indexed: true },
      { name: "mandateId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "registerMandate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "mandate", type: "tuple", components: mandateComponents },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "mandateId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "reserve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "mandateId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "reservationId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "finalize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reservationId", type: "bytes32" },
      { name: "actual", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [{ name: "reservationId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "revoke",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "revocation",
        type: "tuple",
        components: [
          { name: "mandateId", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "reason", type: "string" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "amend",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "amendment",
        type: "tuple",
        components: [
          { name: "mandateId", type: "bytes32" },
          { name: "field", type: "uint256" },
          { name: "newValue", type: "uint256" },
          { name: "newValueText", type: "string" },
          { name: "scopeServiceId", type: "string" },
          { name: "oneTime", type: "bool" },
          { name: "validUntil", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "successorId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "setTraceTopic",
    stateMutability: "nonpayable",
    inputs: [
      { name: "mandateId", type: "bytes32" },
      { name: "traceTopic", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "status",
    stateMutability: "view",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "record",
    stateMutability: "view",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [{ name: "result", type: "tuple", components: recordComponents }],
  },
] as const;

export const hederaTestnetChain = {
  id: 296,
  name: "Hedera testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 8 },
  rpcUrls: { default: { http: ["https://testnet.hashio.io/api"] } },
  testnet: true,
} as const satisfies Chain;

export type ContractMandate = {
  agent: string;
  broker: Address;
  spendAccount: string;
  allowedServices: string;
  allowedMethods: string;
  asset: string;
  maxPerRequest: bigint;
  maxPerRequestText: string;
  maxPerPeriod: bigint;
  maxPerPeriodText: string;
  periodSeconds: bigint;
  maxLifetime: bigint;
  maxLifetimeText: string;
  maxUnitsPerRequest: bigint;
  validFrom: bigint;
  validUntil: bigint;
  validUntilText: string;
  quoteMaxAgeSeconds: bigint;
  dataClass: number;
  escalationRule: string;
  policyHash: Hex;
  nonce: bigint;
  predecessor: Hex;
};

export function toContractMandate(input: AgentMandate): ContractMandate {
  const mandate = agentMandateSchema.parse(input);
  return {
    agent: mandate.agent,
    broker: mandate.broker as Address,
    spendAccount: mandate.spendAccount,
    allowedServices: mandate.allowedServices,
    allowedMethods: mandate.allowedMethods,
    asset: mandate.asset,
    maxPerRequest: BigInt(mandate.maxPerRequest),
    maxPerRequestText: mandate.maxPerRequestText,
    maxPerPeriod: BigInt(mandate.maxPerPeriod),
    maxPerPeriodText: mandate.maxPerPeriodText,
    periodSeconds: BigInt(mandate.periodSeconds),
    maxLifetime: BigInt(mandate.maxLifetime),
    maxLifetimeText: mandate.maxLifetimeText,
    maxUnitsPerRequest: BigInt(mandate.maxUnitsPerRequest),
    validFrom: BigInt(mandate.validFrom),
    validUntil: BigInt(mandate.validUntil),
    validUntilText: mandate.validUntilText,
    quoteMaxAgeSeconds: BigInt(mandate.quoteMaxAgeSeconds),
    dataClass: mandate.dataClass,
    escalationRule: mandate.escalationRule,
    policyHash: mandate.policyHash as Hex,
    nonce: BigInt(mandate.nonce),
    predecessor: mandate.predecessor as Hex,
  };
}

export type RegistryRecord = {
  principal: Address;
  broker: Address;
  policyHash: Hex;
  limits: {
    maxPerRequest: string;
    maxPerPeriod: string;
    periodSeconds: string;
    maxLifetime: string;
    validFrom: string;
    validUntil: string;
  };
  lifetimeConsumed: string;
  periodIndex: string;
  periodConsumed: string;
  reserved: string;
  status: number;
  successor: Hex;
  traceTopic: string;
};

type RawRecord = {
  principal: Address;
  broker: Address;
  policyHash: Hex;
  limits: Record<string, bigint>;
  lifetimeConsumed: bigint;
  periodIndex: bigint;
  periodConsumed: bigint;
  reserved: bigint;
  status: bigint | number;
  successor: Hex;
  traceTopic: string;
};

function normalizeRecord(value: unknown): RegistryRecord {
  const raw = value as RawRecord;
  if (!raw || typeof raw !== "object" || !raw.principal || !raw.broker || !raw.limits) {
    throw new Error("registry returned an invalid mandate record");
  }
  const limits = raw.limits;
  const limit = (key: string): bigint => {
    const value = limits[key];
    if (value === undefined) throw new Error(`registry record is missing ${key}`);
    return BigInt(value);
  };
  return {
    principal: raw.principal,
    broker: raw.broker,
    policyHash: raw.policyHash,
    limits: {
      maxPerRequest: limit("maxPerRequest").toString(),
      maxPerPeriod: limit("maxPerPeriod").toString(),
      periodSeconds: limit("periodSeconds").toString(),
      maxLifetime: limit("maxLifetime").toString(),
      validFrom: limit("validFrom").toString(),
      validUntil: limit("validUntil").toString(),
    },
    lifetimeConsumed: BigInt(raw.lifetimeConsumed).toString(),
    periodIndex: BigInt(raw.periodIndex).toString(),
    periodConsumed: BigInt(raw.periodConsumed).toString(),
    reserved: BigInt(raw.reserved).toString(),
    status: Number(raw.status),
    successor: raw.successor,
    traceTopic: raw.traceTopic,
  };
}

export type RegistryClientOptions = {
  contractAddress: Address | string;
  rpcUrl?: string;
  publicClient?: PublicClient;
  walletClient?: WalletClient;
  privateKey?: Hex | string;
};

export type RegistryClient = {
  publicClient: PublicClient;
  readStatus(mandateId: Hex): Promise<number>;
  readRecord(mandateId: Hex): Promise<RegistryRecord>;
  registerMandate(mandate: AgentMandate, signature: Hex | string): Promise<Hash>;
  reserve(mandateId: Hex, amountTinybar: string): Promise<Hash>;
  finalize(reservationId: Hex, actualTinybar: string): Promise<Hash>;
  release(reservationId: Hex): Promise<Hash>;
  revoke(revocation: { mandateId: Hex; nonce: string; reason: string }, signature: Hex | string): Promise<Hash>;
  amend(
    amendment: {
      mandateId: Hex;
      field: number;
      newValue: string;
      newValueText: string;
      scopeServiceId: string;
      oneTime: boolean;
      validUntil: number;
      nonce: string;
    },
    signature: Hex | string,
  ): Promise<Hash>;
  setTraceTopic(mandateId: Hex, traceTopic: string): Promise<Hash>;
};

function asSignature(value: Hex | string): Hex {
  return signatureSchema.parse(value) as Hex;
}

function asBytes32(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("value must be a bytes32 hex string");
  return value;
}

function asAddress(value: Address | string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("contractAddress must be a 20-byte EVM address");
  return value as Address;
}

function amount(value: string, field: string): bigint {
  integerString.parse(value);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${field} must be positive`);
  return parsed;
}

export function createRegistryClient(options: RegistryClientOptions): RegistryClient {
  const contractAddress = asAddress(options.contractAddress);
  const rpcUrl = options.rpcUrl ?? hederaTestnetChain.rpcUrls.default.http[0];
  const publicClient = options.publicClient ?? createPublicClient({ chain: hederaTestnetChain, transport: http(rpcUrl) });
  let walletClient = options.walletClient;
  if (!walletClient && options.privateKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) throw new Error("privateKey must be a 32-byte hex key");
    const account = privateKeyToAccount(options.privateKey as Hex);
    walletClient = createWalletClient({ account, chain: hederaTestnetChain, transport: http(rpcUrl) });
  }

  function requireWallet(): WalletClient {
    if (!walletClient?.account) throw new Error("wallet client with an account is required for registry writes");
    return walletClient;
  }

  return {
    publicClient,
    async readStatus(mandateId) {
      const result = await publicClient.readContract({
        address: contractAddress,
        abi: mandateRegistryAbi,
        functionName: "status",
        args: [asBytes32(mandateId)],
      });
      return Number(result);
    },
    async readRecord(mandateId) {
      const result = await publicClient.readContract({
        address: contractAddress,
        abi: mandateRegistryAbi,
        functionName: "record",
        args: [asBytes32(mandateId)],
      });
      return normalizeRecord(result);
    },
    async registerMandate(mandate, signature) {
      return requireWallet().writeContract({
        account: requireWallet().account!,
        chain: hederaTestnetChain,
        address: contractAddress,
        abi: mandateRegistryAbi,
        functionName: "registerMandate",
        args: [toContractMandate(mandate), asSignature(signature)],
      });
    },
    async reserve(mandateId, amountTinybar) {
      return requireWallet().writeContract({
        account: requireWallet().account!,
        chain: hederaTestnetChain,
        address: contractAddress,
        abi: mandateRegistryAbi,
        functionName: "reserve",
        args: [asBytes32(mandateId), amount(amountTinybar, "amountTinybar")],
      });
    },
    async finalize(reservationId, actualTinybar) {
      return requireWallet().writeContract({
        account: requireWallet().account!,
        chain: hederaTestnetChain,
        address: contractAddress,
        abi: mandateRegistryAbi,
        functionName: "finalize",
        args: [asBytes32(reservationId), amount(actualTinybar, "actualTinybar")],
      });
    },
    async release(reservationId) {
      return requireWallet().writeContract({
        account: requireWallet().account!,
        chain: hederaTestnetChain,
        address: contractAddress,
        abi: mandateRegistryAbi,
        functionName: "release",
        args: [asBytes32(reservationId)],
      });
    },
    async revoke(revocation, signature) {
      integerString.parse(revocation.nonce);
      if (!revocation.reason) throw new Error("revocation reason is required");
      return requireWallet().writeContract({
        account: requireWallet().account!,
        chain: hederaTestnetChain,
        address: contractAddress,
        abi: mandateRegistryAbi,
        functionName: "revoke",
        args: [
          {
            mandateId: asBytes32(revocation.mandateId),
            nonce: BigInt(revocation.nonce),
            reason: revocation.reason,
          },
          asSignature(signature),
        ],
      });
    },
    async amend(amendment, signature) {
      integerString.parse(amendment.newValue);
      integerString.parse(amendment.nonce);
      if (!Number.isSafeInteger(amendment.field) || amendment.field < 0) throw new Error("amendment field is invalid");
      if (!Number.isSafeInteger(amendment.validUntil) || amendment.validUntil < 0) throw new Error("amendment expiry is invalid");
      if (!amendment.newValueText) throw new Error("amendment display value is required");
      return requireWallet().writeContract({
        account: requireWallet().account!,
        chain: hederaTestnetChain,
        address: contractAddress,
        abi: mandateRegistryAbi,
        functionName: "amend",
        args: [
          {
            mandateId: asBytes32(amendment.mandateId),
            field: BigInt(amendment.field),
            newValue: BigInt(amendment.newValue),
            newValueText: amendment.newValueText,
            scopeServiceId: amendment.scopeServiceId,
            oneTime: amendment.oneTime,
            validUntil: BigInt(amendment.validUntil),
            nonce: BigInt(amendment.nonce),
          },
          asSignature(signature),
        ],
      });
    },
    async setTraceTopic(mandateId, traceTopic) {
      if (!traceTopic) throw new Error("traceTopic is required");
      return requireWallet().writeContract({
        account: requireWallet().account!,
        chain: hederaTestnetChain,
        address: contractAddress,
        abi: mandateRegistryAbi,
        functionName: "setTraceTopic",
        args: [asBytes32(mandateId), traceTopic],
      });
    },
  };
}

export type HcsWriterOptions = {
  network: "hedera:testnet" | "hedera:mainnet";
  operatorId: string;
  privateKey: string;
  client?: HederaClient;
};

export type HcsWriter = {
  createTopic(memo: string): Promise<{ topicId: string; transactionId: string }>;
  submitMessage(topicId: string, envelope: HcsEnvelope): Promise<string>;
  submitServiceManifest(topicId: string, manifest: ServiceManifest): Promise<string>;
  close(): void;
};

export function canonicalServiceManifestMessage(manifest: unknown): string {
  return canonicalizeJson(serviceManifestSchema.parse(manifest));
}

export function createHcsWriter(options: HcsWriterOptions): HcsWriter {
  if (!options.operatorId || !options.privateKey) throw new Error("HCS operator credentials are required");
  const client = options.client ?? (options.network === "hedera:testnet" ? HederaClient.forTestnet() : HederaClient.forMainnet());
  client.setOperator(options.operatorId, options.privateKey);
  return {
    async createTopic(memo) {
      if (!memo) throw new Error("topic memo is required");
      const response = await new TopicCreateTransaction({ topicMemo: memo }).execute(client);
      const receipt = await response.getReceipt(client);
      if (!receipt.topicId) throw new Error("HCS topic creation returned no topic ID");
      return { topicId: receipt.topicId.toString(), transactionId: response.transactionId.toString() };
    },
    async submitMessage(topicId, envelope) {
      if (!topicId) throw new Error("topic ID is required");
      const message = canonicalizeJson(hcsEnvelopeSchema.parse(envelope));
      const response = await new TopicMessageSubmitTransaction({ topicId, message }).execute(client);
      await response.getReceipt(client);
      return response.transactionId.toString();
    },
    async submitServiceManifest(topicId, manifest) {
      if (!topicId) throw new Error("topic ID is required");
      const message = canonicalServiceManifestMessage(manifest);
      const response = await new TopicMessageSubmitTransaction({ topicId, message }).execute(client);
      await response.getReceipt(client);
      return response.transactionId.toString();
    },
    close() {
      client.close();
    },
  };
}

export type MirrorTopicMessage = {
  consensusTimestamp: string | null;
  sequenceNumber: number;
  message: string;
  runningHash: string | null;
  transactionId: string | null;
};

export type MirrorFetcher = (input: string, init?: RequestInit) => Promise<Response>;

type MirrorPayload = {
  messages?: unknown;
  links?: { next?: unknown };
};

type ParsedMirrorMessage = MirrorTopicMessage & {
  bytes: Uint8Array;
  chunk?: { key: string; number: number; total: number };
};

function parseMirrorMessage(value: unknown): ParsedMirrorMessage {
  if (!value || typeof value !== "object") throw new Error("mirror returned an invalid topic message");
  const message = value as Record<string, unknown>;
  if (typeof message.message !== "string") throw new Error("mirror message has no base64 payload");
  const sequenceNumber = Number(message.sequence_number);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0) throw new Error("mirror message sequence is invalid");
  const bytes = Buffer.from(message.message, "base64");
  let chunk: ParsedMirrorMessage["chunk"];
  if (message.chunk_info !== undefined) {
    if (!message.chunk_info || typeof message.chunk_info !== "object") throw new Error("mirror chunk info is invalid");
    const info = message.chunk_info as Record<string, unknown>;
    const initialTransactionId = info.initial_transaction_id;
    const number = Number(info.number);
    const total = Number(info.total);
    if (!initialTransactionId || !Number.isSafeInteger(number) || !Number.isSafeInteger(total) || number < 1 || total < 2 || number > total) {
      throw new Error("mirror chunk info is invalid");
    }
    chunk = { key: JSON.stringify(initialTransactionId), number, total };
  }
  return {
    consensusTimestamp: typeof message.consensus_timestamp === "string" ? message.consensus_timestamp : null,
    sequenceNumber,
    message: bytes.toString("utf8"),
    runningHash: typeof message.running_hash === "string" ? message.running_hash : null,
    transactionId: typeof message.transaction_id === "string" ? message.transaction_id : null,
    bytes,
    chunk,
  };
}

function completeMirrorMessage(chunks: ParsedMirrorMessage[]): MirrorTopicMessage {
  const ordered = [...chunks].sort((left, right) => (left.chunk?.number ?? 0) - (right.chunk?.number ?? 0));
  const last = ordered.at(-1);
  if (!last) throw new Error("mirror message chunk group is empty");
  return {
    consensusTimestamp: last.consensusTimestamp,
    sequenceNumber: last.sequenceNumber,
    message: Buffer.concat(ordered.map((part) => Buffer.from(part.bytes))).toString("utf8"),
    runningHash: last.runningHash,
    transactionId: last.transactionId,
  };
}

function mirrorUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("mirror node URL must use HTTP(S)");
  return url;
}

export async function readTopicMessages(
  topicId: string,
  options: {
    mirrorNodeUrl?: string;
    limit?: number;
    fetcher?: MirrorFetcher;
  } = {},
): Promise<MirrorTopicMessage[]> {
  if (!/^0\.0\.[1-9][0-9]*$/.test(topicId)) throw new Error("topicId must be a Hedera topic ID");
  const requested = options.limit ?? 100;
  if (!Number.isSafeInteger(requested) || requested <= 0) throw new Error("limit must be a positive integer");
  const base = mirrorUrl(options.mirrorNodeUrl ?? "https://testnet.mirrornode.hedera.com");
  const fetcher = options.fetcher ?? fetch;
  let next = new URL(`/api/v1/topics/${encodeURIComponent(topicId)}/messages`, base);
  next.searchParams.set("order", "asc");
  const result: MirrorTopicMessage[] = [];
  const pendingChunks = new Map<string, ParsedMirrorMessage[]>();
  while (next && result.length < requested) {
    if (next.origin !== base.origin) throw new Error("mirror pagination crossed origins");
    next.searchParams.set("limit", String(Math.min(requested - result.length, 100)));
    const response = await fetcher(next.toString());
    if (!response.ok) throw new Error(`mirror node returned HTTP ${response.status}`);
    const payload = (await response.json()) as MirrorPayload;
    if (!Array.isArray(payload.messages)) throw new Error("mirror returned no messages array");
    for (const item of payload.messages) {
      const parsed = parseMirrorMessage(item);
      if (!parsed.chunk) {
        result.push(parsed);
      } else {
        const chunks = pendingChunks.get(parsed.chunk.key) ?? [];
        chunks.push(parsed);
        pendingChunks.set(parsed.chunk.key, chunks);
        if (chunks.length === parsed.chunk.total) {
          result.push(completeMirrorMessage(chunks));
          pendingChunks.delete(parsed.chunk.key);
        }
      }
      if (result.length === requested) break;
    }
    const candidate = payload.links?.next;
    if (typeof candidate !== "string" || !candidate) break;
    next = new URL(candidate, base);
  }
  if (pendingChunks.size > 0) throw new Error("mirror topic ended with incomplete message chunks");
  return result;
}
