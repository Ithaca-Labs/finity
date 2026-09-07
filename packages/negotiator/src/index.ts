import { serviceManifestSchema, type ServiceManifest } from "@finity/schemas";
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
