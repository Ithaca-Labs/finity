import type { Express } from "express";
import {
  createFinityService,
  createQuote,
  type CanonicalSigner,
  type FinityServiceOptions,
  type QuoteRequest,
  type UnsignedServiceManifest,
} from "@finity/provider-sdk";
import type { ServiceManifest } from "@finity/schemas";

export const helloWeatherManifest: UnsignedServiceManifest = {
  kind: "finity.manifest",
  version: 1,
  serviceId: "hello-weather@1",
  provider: {
    uaid: "did:aid:finity:hello-weather@1",
    hederaAccount: "0.0.789",
    signingKey: "provider-signing-key-placeholder",
  },
  name: "Hello Weather",
  description: "Deterministic weather lookup for a requested city.",
  baseUrl: "https://hello-weather.example",
  methods: [
    {
      id: "weather.current",
      inputSchemaRef: "https://hello-weather.example/schemas/weather-request.json",
      outputSchemaRef: "https://hello-weather.example/schemas/weather-response.json",
      dataClassMax: 0,
    },
  ],
  pricing: {
    model: "fixed",
    unit: "call",
    asset: "0.0.0",
    network: "hedera:testnet",
  },
  quoteEndpoint: "/quote",
  payTo: "0.0.789",
  receiptKey: "provider-receipt-key-placeholder",
  healthEndpoint: "/health",
  publishedAt: 1788739200,
};

export type HelloWeatherOptions = {
  manifest: ServiceManifest;
  signer: CanonicalSigner;
  facilitator?: FinityServiceOptions["facilitator"];
  facilitatorUrl?: string;
};

export function createHelloWeatherService(options: HelloWeatherOptions): Express {
  const quoteFactory = async (request: QuoteRequest) =>
    createQuote({
      ...request,
      manifest: options.manifest,
      unitPriceTinybar: "5000000",
      signer: options.signer,
    });

  return createFinityService({
    manifest: options.manifest,
    quoteFactory,
    facilitator: options.facilitator,
    facilitatorUrl: options.facilitatorUrl,
    methods: [
      {
        methodId: "weather.current",
        httpMethod: "GET",
        path: "/weather",
        priceTinybar: "5000000",
        handler: (request, response) => {
          const city = typeof request.query.city === "string" ? request.query.city.trim() : "";
          if (!city) {
            response.status(400).json({ error: "city is required" });
            return;
          }
          response.json({ city, condition: "clear", temperatureC: 28 });
        },
      },
    ],
  });
}
