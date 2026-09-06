import express, { type Express, type Request } from "express";
import {
  canonicalizeJson,
  hashCanonicalJson,
  quoteSchema,
  serviceManifestSchema,
  usageReceiptSchema,
  type Hash,
  type Quote,
  type RequestClass,
  type ServiceManifest,
  type UsageReceipt,
} from "@finity/schemas";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { FacilitatorClient, RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import type { RequestHandler } from "express";

export interface CanonicalSigner {
  sign(canonicalJson: string): Promise<string>;
}

export type UnsignedServiceManifest = Omit<ServiceManifest, "signature">;

export type QuoteRequest = {
  methodId: string;
  requestClass: RequestClass;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

export type QuoteFactory = (request: QuoteRequest) => Promise<Quote>;

export type ProviderMethod = {
  methodId: string;
  httpMethod: "GET" | "POST";
  path: `/${string}`;
  priceTinybar: string;
  handler: RequestHandler;
};

export type FinityServiceOptions = {
  manifest: ServiceManifest;
  methods: ProviderMethod[];
  quoteFactory: QuoteFactory;
  facilitator?: FacilitatorClient;
  facilitatorUrl?: string;
};

export type QuoteBuildInput = QuoteRequest & {
  manifest: ServiceManifest;
  unitPriceTinybar: string;
  signer: CanonicalSigner;
};

export type UsageReceiptBuildInput = Omit<UsageReceipt, "kind" | "signature"> & {
  signer: CanonicalSigner;
};

function unsigned<T extends { signature: string }>(artifact: T): Omit<T, "signature"> {
  const { signature: _signature, ...withoutSignature } = artifact;
  return withoutSignature;
}

function positiveInteger(value: string, field: string): bigint {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${field} must be an unsigned integer string`);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${field} must be positive`);
  return parsed;
}

export function hashUnsignedManifest(manifest: UnsignedServiceManifest | ServiceManifest): Hash {
  return hashCanonicalJson("signature" in manifest ? unsigned(manifest) : manifest);
}

export async function signManifest(
  manifest: UnsignedServiceManifest,
  signer: CanonicalSigner,
): Promise<ServiceManifest> {
  const parsed = serviceManifestSchema.omit({ signature: true }).parse(manifest);
  const signature = await signer.sign(canonicalizeJson(parsed));
  return serviceManifestSchema.parse({ ...parsed, signature });
}

export async function createQuote(input: QuoteBuildInput): Promise<Quote> {
  const manifest = serviceManifestSchema.parse(input.manifest);
  const method = manifest.methods.find((candidate) => candidate.id === input.methodId);
  if (!method) throw new Error("method is not present in the service manifest");
  if (input.requestClass.unit !== manifest.pricing.unit) throw new Error("request unit does not match manifest pricing");
  const units = positiveInteger(input.requestClass.units, "requestClass.units");
  const unitPrice = positiveInteger(input.unitPriceTinybar, "unitPriceTinybar");
  if (manifest.pricing.model === "fixed" && units !== 1n) throw new Error("fixed-price requests must use one unit");
  if (input.issuedAt < 0 || input.expiresAt <= input.issuedAt) throw new Error("quote window is invalid");

  const unsignedQuote = {
    kind: "finity.quote" as const,
    serviceId: manifest.serviceId,
    methodId: input.methodId,
    manifestHash: hashUnsignedManifest(manifest),
    requestClass: input.requestClass,
    amount: (unitPrice * units).toString(),
    asset: manifest.pricing.asset,
    network: manifest.pricing.network,
    payTo: manifest.payTo,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  const signature = await input.signer.sign(canonicalizeJson(unsignedQuote));
  return quoteSchema.parse({ ...unsignedQuote, signature });
}

export async function createUsageReceipt(input: UsageReceiptBuildInput): Promise<UsageReceipt> {
  const unsignedReceipt = {
    kind: "finity.usage" as const,
    serviceId: input.serviceId,
    quoteNonce: input.quoteNonce,
    unitsActual: input.unitsActual,
    amountCharged: input.amountCharged,
    settlementTxId: input.settlementTxId,
    resultHash: input.resultHash,
    issuedAt: input.issuedAt,
  };
  const signature = await input.signer.sign(canonicalizeJson(unsignedReceipt));
  return usageReceiptSchema.parse({ ...unsignedReceipt, signature });
}

function queryString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} is required`);
  return value;
}

function queryTimestamp(value: unknown, field: string): number {
  const parsed = Number(queryString(value, field));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${field} must be a UNIX timestamp`);
  return parsed;
}

function quoteRequestFromHttp(request: Request): QuoteRequest {
  const unit = queryString(request.query.unit, "unit") as RequestClass["unit"];
  if (!["call", "char", "token", "row", "byte", "second"].includes(unit)) throw new Error("unit is invalid");
  return {
    methodId: queryString(request.query.methodId, "methodId"),
    requestClass: { unit, units: queryString(request.query.units, "units") },
    nonce: queryString(request.query.nonce, "nonce"),
    issuedAt: queryTimestamp(request.query.issuedAt, "issuedAt"),
    expiresAt: queryTimestamp(request.query.expiresAt, "expiresAt"),
  };
}

export function createFinityService(options: FinityServiceOptions): Express {
  const manifest = serviceManifestSchema.parse(options.manifest);
  const methods = new Map(options.methods.map((method) => [method.methodId, method]));
  if (methods.size !== options.methods.length) throw new Error("duplicate provider method configuration");
  for (const method of manifest.methods) {
    if (!methods.has(method.id)) throw new Error(`missing handler for manifest method ${method.id}`);
  }
  if (!options.facilitator && !options.facilitatorUrl) {
    throw new Error("facilitator or facilitatorUrl is required; payments fail closed");
  }

  const facilitator = options.facilitator ?? new HTTPFacilitatorClient({ url: options.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitator).register(
    manifest.pricing.network,
    new ExactHederaScheme(),
  );
  const routes: RoutesConfig = {};
  for (const method of options.methods) {
    routes[`${method.httpMethod} ${method.path}`] = {
      accepts: {
        scheme: "exact",
        price: { asset: manifest.pricing.asset, amount: method.priceTinybar },
        network: manifest.pricing.network,
        payTo: manifest.payTo,
        maxTimeoutSeconds: 60,
      },
      resource: `${manifest.baseUrl}${method.path}`,
      description: manifest.description,
      serviceName: manifest.name,
      mimeType: "application/json",
    };
  }

  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.get(manifest.healthEndpoint, (_request, response) => {
    response.json({ ok: true, serviceId: manifest.serviceId, version: manifest.version });
  });
  app.get(manifest.quoteEndpoint, async (request, response) => {
    try {
      response.json(await options.quoteFactory(quoteRequestFromHttp(request)));
    } catch {
      response.status(400).json({ error: "invalid_quote_request" });
    }
  });
  app.use(paymentMiddleware(routes, resourceServer, undefined, undefined, false));
  for (const method of options.methods) {
    if (method.httpMethod === "GET") app.get(method.path, method.handler);
    else app.post(method.path, method.handler);
  }
  return app;
}

export function hashResult(value: unknown): Hash {
  return hashCanonicalJson(value);
}
