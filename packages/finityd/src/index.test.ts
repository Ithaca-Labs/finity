import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { compile } from "@finity/mandate-compiler";
import type { ServiceManifest, SignedAgentMandate } from "@finity/schemas";
import { MandateStore, PurchaseStore, startFinityd, type Finityd } from "./index.js";

let running: Finityd | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function baseUrl(instance: Finityd): Promise<string> {
  if (!instance.server.listening) await new Promise((resolve) => instance.server.once("listening", resolve));
  const address = instance.server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

describe("finityd HTTP API", () => {
  it("rejects requests without the bearer token", async () => {
    running = startFinityd();
    const response = await fetch(`${await baseUrl(running)}/v1/health`);
    expect(response.status).toBe(401);
  });

  it("reports health once authenticated", async () => {
    running = startFinityd();
    const response = await fetch(`${await baseUrl(running)}/v1/health`, { headers: { authorization: `Bearer ${running.token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("threads the executor's result and refusal payloads back into the stored purchase", async () => {
    running = startFinityd({
      executor: async (purchase, transition) => {
        transition({ type: "DISCOVERED" });
        transition({ type: "QUOTED" });
        transition({ type: "EVALUATING" });
        transition({ type: "REFUSED" }, { refusal: { reasonCodes: ["SERVICE_NOT_ALLOWED"] } });
      },
    });
    const created = await fetch(`${await baseUrl(running)}/v1/intents`, {
      method: "POST",
      headers: { authorization: `Bearer ${running.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        mandateId: `0x${"01".repeat(32)}`,
        agentUaid: "did:aid:buyer",
        payloadRef: "ref://1",
        requestClass: { unit: "call", units: "1" },
        dataClass: 0,
      }),
    });
    expect(created.status).toBe(202);
    const { correlationId } = (await created.json()) as { correlationId: string };

    await new Promise((resolve) => setTimeout(resolve, 10));
    const fetched = await fetch(`${await baseUrl(running)}/v1/intents/${correlationId}`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(fetched.status).toBe(200);
    const purchase = await fetched.json();
    expect(purchase).toMatchObject({ state: "REFUSED", refusal: { reasonCodes: ["SERVICE_NOT_ALLOWED"] } });
  });
});

const compiled = compile({
  agent: "did:aid:buyer", broker: "0x1111111111111111111111111111111111111111", spendAccount: "0.0.123",
  allowedServices: "hello-weather@1", allowedMethods: "weather.current", asset: "HBAR",
  maxPerRequest: "5000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000",
  maxUnitsPerRequest: "0", validFrom: 1_788_739_200, validUntil: 1_790_208_000, quoteMaxAgeSeconds: "120",
  dataClass: 0, escalationRule: "anything above per-request cap needs my Ledger",
  policyHash: `0x${"aa".repeat(32)}`, nonce: "1", predecessor: `0x${"00".repeat(32)}`,
  verifyingContract: "0x2222222222222222222222222222222222222222",
});
const mandate: SignedAgentMandate = { ...compiled.canonicalMandate, signature: `0x${"bb".repeat(65)}`, mandateId: compiled.mandateId };
const manifest: ServiceManifest = {
  kind: "finity.manifest", version: 1, serviceId: "hello-weather@1",
  provider: { uaid: "did:aid:provider", hederaAccount: "0.0.789", signingKey: "provider-key" },
  name: "Hello Weather", description: "Current conditions.", baseUrl: "https://weather.example.test",
  methods: [{ id: "weather.current", inputSchemaRef: "in", outputSchemaRef: "out", dataClassMax: 0 }],
  pricing: { model: "fixed", unit: "call", asset: "0.0.0", network: "hedera:testnet" },
  quoteEndpoint: "/quote", payTo: "0.0.789", receiptKey: "receipt-key", healthEndpoint: "/health",
  publishedAt: 1_788_739_200, signature: `0x${"cc".repeat(65)}`,
};

function mirrorFetcherWith(entries: unknown[]): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        messages: entries.map((entry, index) => ({
          consensus_timestamp: `${index}.0`, sequence_number: index,
          message: Buffer.from(JSON.stringify(entry), "utf8").toString("base64"),
          running_hash: null, transaction_id: null,
        })),
        links: { next: null },
      }),
      { status: 200 },
    )) as typeof fetch;
}

describe("finityd HTTP API services/quotes routes", () => {
  it("returns 501 when no services dependencies are configured", async () => {
    running = startFinityd();
    const response = await fetch(`${await baseUrl(running)}/v1/services?mandateId=${compiled.mandateId}`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(response.status).toBe(501);
  });

  it("discovers eligible manifests for a known mandate", async () => {
    const mandateStore = new MandateStore();
    mandateStore.set(compiled.mandateId, mandate);
    running = startFinityd({ services: { mandateStore, topicId: "0.0.1", mirrorFetcher: mirrorFetcherWith([manifest]) } });
    const response = await fetch(`${await baseUrl(running)}/v1/services?mandateId=${compiled.mandateId}`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ manifests: [{ serviceId: "hello-weather@1" }] });
  });

  it("404s discovery for an unknown mandate", async () => {
    running = startFinityd({ services: { mandateStore: new MandateStore(), topicId: "0.0.1", mirrorFetcher: mirrorFetcherWith([]) } });
    const response = await fetch(`${await baseUrl(running)}/v1/services?mandateId=${`0x${"99".repeat(32)}`}`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(response.status).toBe(404);
  });

  it("returns a signed quote for a known mandate, service, and method", async () => {
    const mandateStore = new MandateStore();
    mandateStore.set(compiled.mandateId, mandate);
    const quotePayload = {
      kind: "finity.quote", serviceId: "hello-weather@1", methodId: "weather.current",
      manifestHash: `0x${"dd".repeat(32)}`, requestClass: { unit: "call", units: "1" },
      amount: "5000000", asset: "0.0.0", network: "hedera:testnet", payTo: "0.0.789",
      nonce: "00000000-0000-4000-8000-000000000001", issuedAt: 100, expiresAt: 160, signature: `0x${"ee".repeat(65)}`,
    };
    running = startFinityd({
      services: {
        mandateStore, topicId: "0.0.1",
        mirrorFetcher: mirrorFetcherWith([manifest]),
        quoteFetcher: (async () => new Response(JSON.stringify(quotePayload), { status: 200 })) as typeof fetch,
        now: () => 100,
      },
    });
    const response = await fetch(`${await baseUrl(running)}/v1/quotes`, {
      method: "POST",
      headers: { authorization: `Bearer ${running.token}`, "content-type": "application/json" },
      body: JSON.stringify({ mandateId: compiled.mandateId, serviceId: "hello-weather@1", methodId: "weather.current", requestClass: { unit: "call", units: "1" } }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ quotes: [{ serviceId: "hello-weather@1", amount: "5000000" }] });
  });
});

describe("PurchaseStore on-disk persistence", () => {
  it("survives being reopened from the same file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "finityd-purchase-store-"));
    const dbPath = join(dir, "purchases.sqlite");
    try {
      const first = new PurchaseStore(dbPath);
      const purchase = first.create({
        mandateId: `0x${"01".repeat(32)}`, agentUaid: "did:aid:buyer", payloadRef: "ref://1",
        requestClass: { unit: "call", units: "1" }, dataClass: 0,
      });
      first.transition(purchase.correlationId, { type: "DISCOVERED" });
      first.close();

      const reopened = new PurchaseStore(dbPath);
      try {
        expect(reopened.get(purchase.correlationId)).toMatchObject({ state: "DISCOVERED" });
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
