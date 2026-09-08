import { describe, expect, it } from "vitest";
import { decodeEventLog, encodeEventTopics, encodeAbiParameters } from "viem";
import { canonicalServiceManifestMessage, createRegistryClient, mandateRegistryAbi, readTopicMessages, toContractMandate } from "./index.js";

const mandate = {
  agent: "did:aid:buyer",
  broker: "0x1111111111111111111111111111111111111111",
  spendAccount: "0.0.123",
  allowedServices: "hello-weather@1",
  allowedMethods: "GET:/weather",
  asset: "HBAR" as const,
  maxPerRequest: "5000000",
  maxPerRequestText: "0.05 HBAR",
  maxPerPeriod: "500000000",
  maxPerPeriodText: "5.00 HBAR per 24h",
  periodSeconds: "86400",
  maxLifetime: "2000000000",
  maxLifetimeText: "20.00 HBAR total",
  maxUnitsPerRequest: "1",
  validFrom: 1788739200,
  validUntil: 1790208000,
  validUntilText: "2026-09-23",
  quoteMaxAgeSeconds: "120",
  dataClass: 0,
  escalationRule: "above cap needs Ledger",
  policyHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  nonce: "1",
  predecessor: "0x0000000000000000000000000000000000000000000000000000000000000000",
};

describe("registry client", () => {
  it("canonicalizes only schema-valid service manifests for HCS publication", () => {
    const message = canonicalServiceManifestMessage({
      kind: "finity.manifest",
      version: 1,
      serviceId: "weather@1",
      provider: { uaid: "did:aid:provider", hederaAccount: "0.0.123", signingKey: "key" },
      name: "Weather",
      description: "Weather service",
      baseUrl: "https://weather.example",
      methods: [{ id: "weather.current", inputSchemaRef: "schema:in", outputSchemaRef: "schema:out", dataClassMax: 0 }],
      pricing: { model: "fixed", unit: "call", asset: "0.0.0", network: "hedera:testnet" },
      quoteEndpoint: "/quote",
      payTo: "0.0.123",
      receiptKey: "key",
      healthEndpoint: "/health",
      publishedAt: 1,
      signature: `0x${"11".repeat(65)}`,
    });
    expect(message).toContain('"serviceId":"weather@1"');
    expect(() => canonicalServiceManifestMessage({ kind: "finity.manifest" })).toThrow();
  });
  it("converts schema values to contract ABI values", () => {
    const result = toContractMandate(mandate);
    expect(result.maxPerRequest).toBe(5000000n);
    expect(result.validUntil).toBe(1790208000n);
    expect(result.broker).toBe(mandate.broker);
  });

  it("decodes reservation IDs from registry receipts", () => {
    const reservationId = `0x${"11".repeat(32)}` as `0x${string}`;
    const mandateId = `0x${"22".repeat(32)}` as `0x${string}`;
    const topics = encodeEventTopics({
      abi: mandateRegistryAbi,
      eventName: "ReservationCreated",
      args: { reservationId, mandateId },
    }) as [`0x${string}`, `0x${string}`, `0x${string}`];
    const decoded = decodeEventLog({
      abi: mandateRegistryAbi,
      data: encodeAbiParameters([{ type: "uint256" }], [5000000n]),
      topics,
    });
    expect(decoded.eventName).toBe("ReservationCreated");
    expect(decoded.args.reservationId).toBe(reservationId);
    expect(decoded.args.mandateId).toBe(mandateId);
    expect(decoded.args.amount).toBe(5000000n);
  });

  it("rejects writes without a configured wallet", async () => {
    const client = createRegistryClient({ contractAddress: "0x2222222222222222222222222222222222222222" });
    await expect(client.reserve("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1")).rejects.toThrow(
      "wallet client with an account is required",
    );
  });

  it("decodes and follows same-origin mirror pages", async () => {
    const pages = [
      {
        messages: [
          {
            consensus_timestamp: "1.000000001",
            sequence_number: 1,
            message: Buffer.from("first").toString("base64"),
          },
        ],
        links: { next: "https://mirror.test/api/v1/topics/0.0.1/messages?timestamp=gt:1" },
      },
      {
        messages: [
          {
            consensus_timestamp: "1.000000002",
            sequence_number: 2,
            message: Buffer.from("second").toString("base64"),
          },
        ],
        links: { next: null },
      },
    ];
    const fetcher = async () => new Response(JSON.stringify(pages.shift()), { status: 200 });
    const result = await readTopicMessages("0.0.1", { mirrorNodeUrl: "https://mirror.test", fetcher });
    expect(result.map((message) => message.message)).toEqual(["first", "second"]);
  });

  it("accepts Mirror Node chunk_info total=1 as an unchunked message", async () => {
    const fetcher = async () => new Response(JSON.stringify({
      messages: [{
        consensus_timestamp: "1.0", sequence_number: 1,
        message: Buffer.from("hello").toString("base64"),
        chunk_info: { initial_transaction_id: { account_id: "0.0.1", transaction_valid_start: "1.0" }, number: 1, total: 1 },
      }],
      links: { next: null },
    }), { status: 200 });
    const result = await readTopicMessages("0.0.1", { mirrorNodeUrl: "https://mirror.test", fetcher });
    expect(result).toMatchObject([{ message: "hello" }]);
  });

  it("reassembles Hedera mirror chunks before returning messages", async () => {
    const initialTransactionId = { account_id: "0.0.123", transaction_valid_start: "1.000000001" };
    const first = Buffer.from('{"hello":"world"}');
    const second = Buffer.from("\u0000", "utf8");
    const pages = [
      {
        messages: [
          {
            consensus_timestamp: "1.000000001",
            sequence_number: 1,
            message: first.toString("base64"),
            chunk_info: { initial_transaction_id: initialTransactionId, number: 1, total: 2 },
          },
        ],
        links: { next: "https://mirror.test/api/v1/topics/0.0.1/messages?timestamp=gt:1" },
      },
      {
        messages: [
          {
            consensus_timestamp: "1.000000002",
            sequence_number: 2,
            message: second.toString("base64"),
            chunk_info: { initial_transaction_id: initialTransactionId, number: 2, total: 2 },
          },
        ],
        links: { next: null },
      },
    ];
    const fetcher = async () => new Response(JSON.stringify(pages.shift()), { status: 200 });
    const result = await readTopicMessages("0.0.1", { mirrorNodeUrl: "https://mirror.test", fetcher });
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe('{"hello":"world"}\u0000');
  });

  it("rejects cross-origin mirror pagination", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({ messages: [], links: { next: "https://attacker.test/topics/0.0.1/messages" } }),
        { status: 200 },
      );
    await expect(readTopicMessages("0.0.1", { mirrorNodeUrl: "https://mirror.test", fetcher })).rejects.toThrow(
      "mirror pagination crossed origins",
    );
  });
});
