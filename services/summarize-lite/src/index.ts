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

export const SUMMARIZATION_UNIT_CHARS = 1000;
export const SUMMARIZATION_UNIT_PRICE_TINYBAR = "1000";
export const SUMMARIZATION_REQUEST_PRICE_TINYBAR = "1000000";

export const summarizeLiteManifest: UnsignedServiceManifest = {
  kind: "finity.manifest",
  version: 1,
  serviceId: "summarize-lite@1",
  provider: {
    uaid: "did:aid:finity:summarize-lite@1",
    hederaAccount: "0.0.789",
    signingKey: "provider-signing-key-placeholder",
  },
  name: "Summarize Lite",
  description: "Bounded deterministic summarization for one 1,000-character unit.",
  baseUrl: "https://summarize-lite.example",
  methods: [
    {
      id: "summarize.text",
      inputSchemaRef: "https://summarize-lite.example/schemas/summarize-request.json",
      outputSchemaRef: "https://summarize-lite.example/schemas/summarize-response.json",
      dataClassMax: 1,
    },
  ],
  pricing: {
    model: "per_unit",
    unit: "char",
    asset: "0.0.0",
    network: "hedera:testnet",
  },
  quoteEndpoint: "/quote",
  payTo: "0.0.789",
  receiptKey: "provider-receipt-key-placeholder",
  healthEndpoint: "/health",
  publishedAt: 1788739200,
};

export type SummarizeLiteOptions = {
  manifest: ServiceManifest;
  signer: CanonicalSigner;
  facilitator?: FinityServiceOptions["facilitator"];
  facilitatorUrl?: string;
};

export function createSummarizeLiteService(options: SummarizeLiteOptions): Express {
  const quoteFactory = async (request: QuoteRequest) => {
    if (request.requestClass.units !== String(SUMMARIZATION_UNIT_CHARS)) {
      throw new Error("summarize-lite quotes require exactly one 1,000-character unit");
    }
    return createQuote({
      ...request,
      manifest: options.manifest,
      unitPriceTinybar: SUMMARIZATION_UNIT_PRICE_TINYBAR,
      signer: options.signer,
    });
  };

  return createFinityService({
    manifest: options.manifest,
    quoteFactory,
    facilitator: options.facilitator,
    facilitatorUrl: options.facilitatorUrl,
    methods: [
      {
        methodId: "summarize.text",
        httpMethod: "POST",
        path: "/summarize",
        priceTinybar: SUMMARIZATION_REQUEST_PRICE_TINYBAR,
        handler: (request, response) => {
          const text = request.body?.text;
          if (typeof text !== "string" || text.length === 0 || text.length > SUMMARIZATION_UNIT_CHARS) {
            response.status(400).json({ error: "text must contain 1-1000 characters" });
            return;
          }
          response.json({ summary: text.trim().slice(0, 160), units: text.length });
        },
      },
    ],
  });
}
