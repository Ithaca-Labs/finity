import { describe, expect, it } from "vitest";
import type { Quote, ServiceManifest } from "@finity/schemas";
import { NegotiatorError, discover, quote, select } from "./index.js";

const helloWeather: ServiceManifest = {
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

const validQuote: Quote = {
  kind: "finity.quote", serviceId: "hello-weather@1", methodId: "weather.current",
  manifestHash: `0x${"a".repeat(64)}`, requestClass: { unit: "call", units: "1" },
  amount: "5000000", asset: "0.0.0", network: "hedera:testnet", payTo: "0.0.789",
  nonce: "00000000-0000-4000-8000-000000000001", issuedAt: 1000, expiresAt: 1060,
  signature: `0x${"c".repeat(130)}`,
};

function jsonFetcher(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("negotiator quote", () => {
  it("requests and validates a signed quote", async () => {
    let requestedUrl = "";
    const fetcher: typeof fetch = (async (input: string) => {
      requestedUrl = input;
      return new Response(JSON.stringify(validQuote), { status: 200 });
    }) as typeof fetch;
    const result = await quote(helloWeather, "weather.current", { unit: "call", units: "1" }, { now: 1000, fetcher });
    expect(result).toMatchObject({ serviceId: "hello-weather@1", methodId: "weather.current" });
    expect(requestedUrl).toContain("/quote?");
    expect(requestedUrl).toContain("methodId=weather.current");
  });

  it("rejects a method the manifest does not offer", async () => {
    await expect(quote(helloWeather, "no.such.method", { unit: "call", units: "1" }, { now: 1000 }))
      .rejects.toMatchObject({ code: "QUOTE_INVALID" } satisfies Partial<NegotiatorError>);
  });

  it("rejects a quote for the wrong service", async () => {
    const fetcher = jsonFetcher({ ...validQuote, serviceId: "other@1" });
    await expect(quote(helloWeather, "weather.current", { unit: "call", units: "1" }, { now: 1000, fetcher }))
      .rejects.toMatchObject({ code: "QUOTE_INVALID" } satisfies Partial<NegotiatorError>);
  });

  it("rejects a non-OK response", async () => {
    const fetcher = jsonFetcher({ error: "boom" }, 500);
    await expect(quote(helloWeather, "weather.current", { unit: "call", units: "1" }, { now: 1000, fetcher }))
      .rejects.toMatchObject({ code: "QUOTE_INVALID" } satisfies Partial<NegotiatorError>);
  });
});

const cheap: Quote = { ...validQuote, serviceId: "hello-weather@1", amount: "1000000" };
const expensive: Quote = { ...validQuote, serviceId: "summarize-lite@1", amount: "9000000" };
const tie: Quote = { ...validQuote, serviceId: "aaa-cheapest@1", amount: "1000000" };

describe("negotiator select", () => {
  it("picks the cheapest quote by default", () => {
    expect(select([expensive, cheap]).serviceId).toBe("hello-weather@1");
  });

  it("breaks ties deterministically by service ID", () => {
    expect(select([cheap, tie]).serviceId).toBe("aaa-cheapest@1");
    expect(select([tie, cheap]).serviceId).toBe("aaa-cheapest@1");
  });

  it("keeps the caller's ordering when preferCheapest is false", () => {
    expect(select([expensive, cheap], { preferCheapest: false }).serviceId).toBe("summarize-lite@1");
  });

  it("throws NO_QUOTES on an empty list", () => {
    expect(() => select([])).toThrow(NegotiatorError);
  });
});
