import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as standardsSdk from "@hashgraphonline/standards-sdk";

export type CanonicalAgentData = {
  registry: string;
  name: string;
  version: string;
  protocol: string;
  nativeId: string;
  skills: number[];
};

// @hashgraphonline/standards-sdk@0.1.186's published declarations do not
// surface canonicalizeAgentData/createUaid/CanonicalAgentData from the
// package root (hcs-14/sdk.d.ts reaches into a bundled-relative path that
// does not resolve, which appears to break the barrel re-export for
// TypeScript even under skipLibCheck). Runtime resolution is unaffected -
// both functions work correctly when called - so this asserts the shape
// TypeScript should see rather than working around a real behavior gap.
const { canonicalizeAgentData, createUaid } = standardsSdk as unknown as {
  canonicalizeAgentData(input: unknown): { normalized: CanonicalAgentData; canonicalJson: string };
  createUaid(input: CanonicalAgentData, params?: { uid?: string }, options?: { includeParams?: boolean }): Promise<string>;
};

export type IdentityInput = {
  name: string;
  nativeId: string;
  uid?: string;
  registry?: string;
  version?: string;
  protocol?: string;
  skills?: number[];
};

export type Identity = {
  uaid: string;
  canonical: CanonicalAgentData;
  canonicalJson: string;
};

/**
 * Generates a deterministic HCS-14 `did:uaid` for an agent or broker, per
 * FINITY_BUILD_SPEC.md §8.13: canonicalize the stable identity fields, then
 * wrap the resulting `did:aid` with routing params (uid, registry, nativeId).
 * Resolution is not required for v1 (spec §4.6), so no network call is made.
 */
export async function generateIdentity(input: IdentityInput): Promise<Identity> {
  const canonical = canonicalizeAgentData({
    registry: input.registry ?? "finity",
    name: input.name,
    version: input.version ?? "1",
    protocol: input.protocol ?? "finity/1",
    nativeId: input.nativeId,
    skills: input.skills ?? [],
  });
  const uaid = await createUaid(canonical.normalized, input.uid ? { uid: input.uid } : undefined, { includeParams: true });
  return { uaid, canonical: canonical.normalized, canonicalJson: canonical.canonicalJson };
}

export type IdentityFile = {
  agent?: Identity;
  broker?: Identity;
};

export async function saveIdentityFile(path: string, identity: IdentityFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
}

export async function loadIdentityFile(path: string): Promise<IdentityFile | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as IdentityFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
