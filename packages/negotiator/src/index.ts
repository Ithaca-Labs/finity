import { randomUUID } from "node:crypto";
import { quoteSchema, serviceManifestSchema, type Quote, type RequestClass, type ServiceManifest } from "@finity/schemas";
import { readTopicMessages, type MirrorFetcher } from "@finity/registry-client";

export class NegotiatorError extends Error {
  constructor(readonly code: "NO_QUOTES" | "QUOTE_INVALID", message: string) {
    super(message);
    this.name = "NegotiatorError";
  }
}

function listIncludes(csv: string, value: string): boolean {
  return csv.split(",").map((item) => item.trim()).filter(Boolean).includes(value);
}

export type DiscoveryFilter = {
  allowedServices: string;
  allowedMethods: string;
  serviceHint?: string;
};

export type DiscoveryOptions = {
  topicId: string;
  mirrorNodeUrl?: string;
  fetcher?: MirrorFetcher;
};

/**
 * Reads the registry HCS topic and returns the newest manifest for each
 * service the mandate allows. Messages that are not a valid, allowed manifest
 * are silently skipped: the topic may carry other envelope types.
 */
export async function discover(filter: DiscoveryFilter, options: DiscoveryOptions): Promise<ServiceManifest[]> {
  const messages = await readTopicMessages(options.topicId, {
    mirrorNodeUrl: options.mirrorNodeUrl,
    fetcher: options.fetcher,
  });
  const latest = new Map<string, ServiceManifest>();
  for (const entry of messages) {
    let manifest: ServiceManifest;
    try {
      manifest = serviceManifestSchema.parse(JSON.parse(entry.message));
    } catch {
      continue;
    }
    if (filter.serviceHint && manifest.serviceId !== filter.serviceHint) continue;
    if (!listIncludes(filter.allowedServices, manifest.serviceId)) continue;
    if (!manifest.methods.some((method) => listIncludes(filter.allowedMethods, method.id))) continue;
    const current = latest.get(manifest.serviceId);
    if (!current || manifest.publishedAt > current.publishedAt) latest.set(manifest.serviceId, manifest);
  }
  return [...latest.values()];
}

export type QuoteFetcher = (input: string) => Promise<Response>;

export type QuoteOptions = {
  now: number;
  windowSeconds?: number;
  fetcher?: QuoteFetcher;
};

/**
 * Requests a signed quote for one manifest method. The response is validated
 * against the manifest before being trusted: the provider still signs the
 * final numbers, but a quote for the wrong service or method is rejected here
 * rather than reaching the policy engine.
 */
export async function quote(manifest: ServiceManifest, methodId: string, requestClass: RequestClass, options: QuoteOptions): Promise<Quote> {
  if (!manifest.methods.some((method) => method.id === methodId)) {
    throw new NegotiatorError("QUOTE_INVALID", "method is not present in the service manifest");
  }
  const fetcher = options.fetcher ?? fetch;
  const url = new URL(manifest.quoteEndpoint, manifest.baseUrl);
  url.searchParams.set("methodId", methodId);
  url.searchParams.set("unit", requestClass.unit);
  url.searchParams.set("units", requestClass.units);
  url.searchParams.set("nonce", randomUUID());
  url.searchParams.set("issuedAt", String(options.now));
  url.searchParams.set("expiresAt", String(options.now + (options.windowSeconds ?? 60)));

  const response = await fetcher(url.toString());
  if (!response.ok) throw new NegotiatorError("QUOTE_INVALID", `quote endpoint returned HTTP ${response.status}`);
  const parsed = quoteSchema.safeParse(await response.json());
  if (!parsed.success) throw new NegotiatorError("QUOTE_INVALID", "quote endpoint returned a malformed quote");
  if (parsed.data.serviceId !== manifest.serviceId || parsed.data.methodId !== methodId) {
    throw new NegotiatorError("QUOTE_INVALID", "quote does not match the requested service or method");
  }
  return parsed.data;
}

export type SelectConstraints = { preferCheapest?: boolean };

/**
 * Deterministic selection over already-fetched quotes. With preferCheapest
 * (the default) the lowest amount wins, ties broken by service ID; otherwise
 * the caller's own ordering is trusted and the first quote wins.
 */
export function select(quotes: Quote[], constraints: SelectConstraints = {}): Quote {
  const [first] = quotes;
  if (!first) throw new NegotiatorError("NO_QUOTES", "no eligible quotes were returned");
  if (constraints.preferCheapest === false) return first;
  const cheapest = quotes.reduce((best, candidate) => {
    const amountDelta = BigInt(candidate.amount) - BigInt(best.amount);
    if (amountDelta < 0n) return candidate;
    if (amountDelta > 0n) return best;
    return candidate.serviceId < best.serviceId ? candidate : best;
  }, first);
  return cheapest;
}
