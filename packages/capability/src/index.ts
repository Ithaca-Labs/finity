import { capabilitySchema, hashCanonicalJson, type Capability, type Hash } from "@finity/schemas";

export type CapabilityDraft = Omit<Capability, "kind" | "capabilityId" | "brokerSignature">;
export type CapabilitySigner = (commitment: Hash) => Promise<`0x${string}`>;

/** Creates the canonical commitment the Broker Session Key signs. */
export function capabilityCommitment(draft: CapabilityDraft): Hash {
  return hashCanonicalJson({ kind: "finity.capability", ...draft });
}

/** Mints a capability without ever exposing the signing key to the caller. */
export async function mintCapability(draft: CapabilityDraft, sign: CapabilitySigner): Promise<Capability> {
  if (draft.expiresAt <= draft.issuedAt || draft.expiresAt - draft.issuedAt > 120) {
    throw new CapabilityError("CAPABILITY_EXPIRED", "capability expiry must be within 120 seconds");
  }
  const capabilityId = capabilityCommitment(draft);
  const capability = capabilitySchema.parse({
    kind: "finity.capability",
    capabilityId,
    ...draft,
    brokerSignature: await sign(capabilityId),
  });
  return capability;
}

export class CapabilityError extends Error {
  constructor(readonly code: "CAPABILITY_REPLAY" | "CAPABILITY_EXPIRED" | "CAPABILITY_INVALID", message: string) {
    super(message);
    this.name = "CapabilityError";
  }
}

/** In-memory single-use guard. Persist capability consumption in finityd for restart safety. */
export class CapabilityGuard {
  private readonly used = new Set<string>();

  lease(input: unknown, now: number): Capability {
    const capability = capabilitySchema.safeParse(input);
    if (!capability.success) throw new CapabilityError("CAPABILITY_INVALID", "malformed capability");
    if (now >= capability.data.expiresAt) throw new CapabilityError("CAPABILITY_EXPIRED", "capability has expired");
    if (this.used.has(capability.data.capabilityId)) {
      throw new CapabilityError("CAPABILITY_REPLAY", "capability has already been used");
    }
    this.used.add(capability.data.capabilityId);
    return capability.data;
  }
}
