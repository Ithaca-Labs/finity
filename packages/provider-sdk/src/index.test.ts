import assert from "node:assert/strict";
import type { FacilitatorClient } from "@x402/core/server";
import { describe, it } from "vitest";
import {
  createFinityService,
  createQuote,
  createUsageReceipt,
  hashResult,
  hashUnsignedManifest,
  type CanonicalSigner,
} from "./index.js";
import type { ServiceManifest } from "@finity/schemas";

const signature = `0x${"11".repeat(65)}`;
const signer: CanonicalSigner = {
  async sign(canonicalJson) {
    assert.ok(canonicalJson.startsWith("{"));
    assert.equal(canonicalJson.includes("signature"), false);
    return signature;
  },
};

const manifest: ServiceManifest = {
  kind: "finity.manifest",
  version: 1,
  serviceId: "hello-weather",
  provider: { uaid: "did:aid:finity:provider", hederaAccount: "0.0.1234", signingKey: "provider-key" },
  name: "Hello Weather",
  description: "Current weather by city.",
  baseUrl: "https://weather.example.test",
  methods: [{ id: "weather.current", inputSchemaRef: "schema:weather-request", outputSchemaRef: "schema:weather-response", dataClassMax: 0 }],
  pricing: { model: "fixed", unit: "call", asset: "0.0.0", network: "hedera:testnet" },
  quoteEndpoint: "/quote",
  payTo: "0.0.5678",
  receiptKey: "receipt-key",
  healthEndpoint: "/health",
  publishedAt: 1_800_000_000,
  signature,
};

const facilitator = {
  async verify() {
    return { isValid: true };
  },
  async settle() {
    return { success: true, transaction: "0.0.1@1.000000000", network: "hedera:testnet" as const };
  },
  async getSupported() {
    return { kinds: [], extensions: [], signers: {} };
  },
} as FacilitatorClient;

describe("provider-sdk", function () {
  it("builds canonical signed quotes and usage receipts", async function () {
    const quote = await createQuote({
      manifest,
      methodId: "weather.current",
      requestClass: { unit: "call", units: "1" },
      nonce: "00000000-0000-4000-8000-000000000001",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_000_060,
      unitPriceTinybar: "5000000",
      signer,
    });
    assert.equal(quote.amount, "5000000");
    assert.equal(quote.manifestHash, hashUnsignedManifest(manifest));

    const receipt = await createUsageReceipt({
      serviceId: quote.serviceId,
      quoteNonce: quote.nonce,
      unitsActual: "1",
      amountCharged: quote.amount,
      settlementTxId: "0.0.1234@1.000000000",
      resultHash: hashResult({ city: "Kolkata", temperatureC: 29 }),
      issuedAt: 1_800_000_001,
      signer,
    });
    assert.equal(receipt.kind, "finity.usage");
    assert.equal(receipt.amountCharged, quote.amount);
  });

  it("fails closed for invalid quote windows and units", async function () {
    await assert.rejects(createQuote({
      manifest,
      methodId: "weather.current",
      requestClass: { unit: "char", units: "1" },
      nonce: "00000000-0000-4000-8000-000000000002",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_000_060,
      unitPriceTinybar: "5000000",
      signer,
    }));
    await assert.rejects(createQuote({
      manifest,
      methodId: "weather.current",
      requestClass: { unit: "call", units: "1" },
      nonce: "00000000-0000-4000-8000-000000000003",
      issuedAt: 1_800_000_060,
      expiresAt: 1_800_000_060,
      unitPriceTinybar: "5000000",
      signer,
    }));
  });

  it("requires an explicit facilitator for x402-protected routes", function () {
    assert.throws(() => createFinityService({
      manifest,
      methods: [{ methodId: "weather.current", httpMethod: "GET", path: "/weather", priceTinybar: "5000000", handler: (_request, response) => response.json({ ok: true }) }],
      quoteFactory: async () => { throw new Error("not used"); },
    }));

    const app = createFinityService({
      manifest,
      methods: [{ methodId: "weather.current", httpMethod: "GET", path: "/weather", priceTinybar: "5000000", handler: (_request, response) => response.json({ ok: true }) }],
      quoteFactory: async () => {
        return createQuote({
          manifest,
          methodId: "weather.current",
          requestClass: { unit: "call", units: "1" },
          nonce: "00000000-0000-4000-8000-000000000004",
          issuedAt: 1_800_000_000,
          expiresAt: 1_800_000_060,
          unitPriceTinybar: "5000000",
          signer,
        });
      },
      facilitator,
    });
    assert.equal(typeof app, "function");
  });

  it("initializes facilitator capabilities before serving protected routes", async function () {
    let supportedCalls = 0;
    const app = createFinityService({
      manifest,
      methods: [{ methodId: "weather.current", httpMethod: "GET", path: "/weather", priceTinybar: "5000000", handler: (_request, response) => response.json({ ok: true }) }],
      quoteFactory: async () => { throw new Error("not used"); },
      facilitator: {
        ...facilitator,
        async getSupported() {
          supportedCalls += 1;
          return {
            kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.1" } }],
            extensions: [],
            signers: {},
          };
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof app, "function");
    assert.equal(supportedCalls, 1);
  });
});
