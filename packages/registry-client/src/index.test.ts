import { describe, expect, it } from "vitest";
import { createRegistryClient, readTopicMessages, toContractMandate } from "./index.js";

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
  it("converts schema values to contract ABI values", () => {
    const result = toContractMandate(mandate);
    expect(result.maxPerRequest).toBe(5000000n);
    expect(result.validUntil).toBe(1790208000n);
    expect(result.broker).toBe(mandate.broker);
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
