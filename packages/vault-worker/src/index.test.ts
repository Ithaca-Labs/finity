import { describe, expect, it } from "vitest";
import { VaultError, VaultWorker, redact } from "./index.js";
import type { Capability, ProviderAccessBundle } from "@finity/schemas";

const capability: Capability = {
  kind: "finity.capability", capabilityId: `0x${"01".repeat(32)}`, mandateId: `0x${"02".repeat(32)}`, mandateVersion: "1", agent: "did:aid:agent", broker: `0x${"03".repeat(20)}`,
  serviceId: "summarize-lite@1", methodId: "POST:/summarize", quoteHash: `0x${"04".repeat(32)}`, maxAmount: "1", maxUnits: "1", dataClassMax: 1, issuedAt: 1, expiresAt: 2_000_000_000,
  reservationId: `0x${"05".repeat(32)}`, brokerSignature: `0x${"11".repeat(65)}`,
};
const pab: ProviderAccessBundle = { credentials: { secret: "FIN" + "ITY_CANARY_SECRET" }, endpointAllowlist: ["https://provider.example.test"], injection: { location: "header", name: "Authorization", format: "Bearer {secret}" } };
describe("vault worker", () => {
  it("redacts credentials and rejects redirects/cross-origin egress", async () => {
    expect(redact({ Authorization: pab.credentials.secret }, pab).Authorization).toBe("[REDACTED]");
    const worker = new VaultWorker(); const lease = worker.lease({ capability, pab, now: 1 });
    await expect(lease.invoke("https://evil.example.test/steal")).rejects.toMatchObject({ code: "EGRESS_BLOCKED" } satisfies Partial<VaultError>);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://evil.example.test" } });
    await expect(lease.invoke("/summarize")).rejects.toMatchObject({ code: "EGRESS_BLOCKED" } satisfies Partial<VaultError>);
    globalThis.fetch = originalFetch;
    expect(() => worker.lease({ capability, pab, now: 1 })).toThrow(VaultError);
  });
});
