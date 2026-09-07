import { describe, expect, it } from "vitest";
import { discover } from "./index.js";

const helloWeather = {
  kind: "finity.manifest", version: 1, serviceId: "hello-weather@1",
  provider: { uaid: "did:aid:provider", hederaAccount: "0.0.789", signingKey: "provider-key" },
  name: "Hello Weather", description: "Current conditions.", baseUrl: "https://weather.example.test",
  methods: [{ id: "weather.current", inputSchemaRef: "in", outputSchemaRef: "out", dataClassMax: 0 }],
  pricing: { model: "fixed", unit: "call", asset: "0.0.0", network: "hedera:testnet" },
  quoteEndpoint: "/quote", payTo: "0.0.789", receiptKey: "receipt-key", healthEndpoint: "/health",
  publishedAt: 100, signature: `0x${"b".repeat(130)}`,
};
const staleHelloWeather = { ...helloWeather, publishedAt: 50, baseUrl: "https://stale.example.test" };
const disallowedService = { ...helloWeather, serviceId: "other@1", publishedAt: 200 };

function mirrorMessage(sequenceNumber: number, payload: unknown) {
  return {
    consensus_timestamp: `${sequenceNumber}.0`,
    sequence_number: sequenceNumber,
    message: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    running_hash: null,
    transaction_id: null,
  };
}

function fakeFetcher(messages: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify({ messages, links: { next: null } }), { status: 200 })) as typeof fetch;
}

describe("negotiator discover", () => {
  it("returns the newest allowed manifest per service and ignores the rest", async () => {
    const messages = [
      mirrorMessage(1, staleHelloWeather),
      mirrorMessage(2, { not: "a manifest" }),
      mirrorMessage(3, disallowedService),
      mirrorMessage(4, helloWeather),
    ];
    const manifests = await discover(
      { allowedServices: "hello-weather@1,summarize-lite@1", allowedMethods: "weather.current" },
      { topicId: "0.0.1", fetcher: fakeFetcher(messages) },
    );
    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toMatchObject({ serviceId: "hello-weather@1", baseUrl: "https://weather.example.test" });
  });

  it("filters out methods the mandate does not allow", async () => {
    const manifests = await discover(
      { allowedServices: "hello-weather@1", allowedMethods: "some.other.method" },
      { topicId: "0.0.1", fetcher: fakeFetcher([mirrorMessage(1, helloWeather)]) },
    );
    expect(manifests).toHaveLength(0);
  });

  it("honors an explicit service hint", async () => {
    const manifests = await discover(
      { allowedServices: "hello-weather@1,other@1", allowedMethods: "weather.current", serviceHint: "other@1" },
      { topicId: "0.0.1", fetcher: fakeFetcher([mirrorMessage(1, helloWeather), mirrorMessage(2, disallowedService)]) },
    );
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.serviceId).toBe("other@1");
  });
});
