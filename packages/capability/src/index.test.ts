import { describe, expect, it } from "vitest";
import { CapabilityError, CapabilityGuard, mintCapability } from "./index.js";

const draft = {
  mandateId: `0x${"01".repeat(32)}`, mandateVersion: "1", agent: "did:aid:agent", broker: `0x${"02".repeat(20)}`,
  serviceId: "hello-weather@1", methodId: "GET:/weather", quoteHash: `0x${"03".repeat(32)}`,
  maxAmount: "5000000", maxUnits: "1", dataClassMax: 0, issuedAt: 100, expiresAt: 200,
  reservationId: `0x${"04".repeat(32)}`,
};

describe("capability", () => {
  it("mints and rejects a second lease", async () => {
    const capability = await mintCapability(draft, async () => `0x${"11".repeat(65)}`);
    const guard = new CapabilityGuard();
    expect(guard.lease(capability, 150).capabilityId).toBe(capability.capabilityId);
    expect(() => guard.lease(capability, 150)).toThrow(CapabilityError);
  });
});
