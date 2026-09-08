import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SignedAgentMandate } from "@finity/schemas";
import { ensureReadyForPurchase, mandateAllows, type BrokerState, type PurchaseReadinessDeps } from "./purchase-readiness.js";

const mandateId = `0x${"11".repeat(32)}`;
const brokerUaid = "uaid:aid:broker";
const mandate: SignedAgentMandate = {
  agent: "uaid:aid:buyer", broker: `0x${"22".repeat(20)}`, spendAccount: "0.0.123",
  allowedServices: "hello-weather@1", allowedMethods: "weather.current", asset: "HBAR",
  maxPerRequest: "5000000", maxPerRequestText: "0.05 HBAR", maxPerPeriod: "5000000",
  maxPerPeriodText: "0.05 HBAR per day", periodSeconds: "86400", maxLifetime: "5000000",
  maxLifetimeText: "0.05 HBAR total", maxUnitsPerRequest: "1", validFrom: 100, validUntil: 1000,
  validUntilText: "test", quoteMaxAgeSeconds: "60", dataClass: 0, escalationRule: "ask",
  policyHash: `0x${"33".repeat(32)}`, nonce: "1", predecessor: `0x${"00".repeat(32)}`,
  signature: `0x${"44".repeat(65)}`, mandateId,
};
const request = { serviceId: "hello-weather@1", methodId: "weather.current", unit: "call", units: "1", amount: "5000000", dataClass: 0 };

async function fixture(): Promise<{ home: string; broker: BrokerState }> {
  const home = await mkdtemp(join(tmpdir(), "finity-ready-"));
  await mkdir(join(home, "bundles"), { recursive: true });
  await mkdir(join(home, "mandates"), { recursive: true });
  await writeFile(join(home, "bundles", "broker.enc"), "ciphertext");
  const identity = { uaid: brokerUaid, canonical: { registry: "finity", name: "broker", version: "1", protocol: "finity/1", nativeId: "hedera:testnet:0.0.123", skills: [] }, canonicalJson: "{}" };
  await writeFile(join(home, "identity.json"), JSON.stringify({ broker: identity }));
  return { home, broker: { identity, bundlePath: join(home, "bundles", "broker.enc") } };
}

function deps(home: string, broker: BrokerState, calls: string[]): PurchaseReadinessDeps {
  return {
    home, now: () => 500, readMandateStatus: async () => 1,
    provisionBroker: async () => { calls.push("broker"); return broker; },
    createMandate: async () => { calls.push("mandate"); return { active: { mandateId, agentUaid: mandate.agent, brokerUaid }, mandate }; },
    ensureDaemon: async () => { calls.push("daemon"); },
  };
}

describe("ensureReadyForPurchase", () => {
  it("reuses an existing broker and active suitable mandate", async () => {
    const { home, broker } = await fixture();
    await writeFile(join(home, "active-mandate.json"), JSON.stringify({ mandateId, agentUaid: mandate.agent, brokerUaid }));
    await writeFile(join(home, "mandates", `${mandateId}.json`), JSON.stringify(mandate));
    const calls: string[] = [];
    const result = await ensureReadyForPurchase(request, deps(home, broker, calls));
    expect(result).toMatchObject({ reusedBroker: true, reusedMandate: true });
    expect(calls).toEqual(["daemon"]);
  });

  it("keeps an existing broker but creates a mandate when the old one cannot authorize the request", async () => {
    const { home, broker } = await fixture();
    await writeFile(join(home, "active-mandate.json"), JSON.stringify({ mandateId, agentUaid: mandate.agent, brokerUaid }));
    await writeFile(join(home, "mandates", `${mandateId}.json`), JSON.stringify({ ...mandate, allowedServices: "other@1" }));
    const calls: string[] = [];
    const result = await ensureReadyForPurchase(request, deps(home, broker, calls));
    expect(result).toMatchObject({ reusedBroker: true, reusedMandate: false });
    expect(calls).toEqual(["daemon", "mandate"]);
  });

  it("provisions broker and mandate when no state exists", async () => {
    const { home, broker } = await fixture();
    await writeFile(join(home, "identity.json"), "{}");
    const calls: string[] = [];
    const result = await ensureReadyForPurchase(request, deps(home, broker, calls));
    expect(result).toMatchObject({ reusedBroker: false, reusedMandate: false });
    expect(calls).toEqual(["broker", "daemon", "mandate"]);
  });
});

describe("mandateAllows", () => {
  it("rejects expired, wrong-service, over-price, and over-class requests", () => {
    expect(mandateAllows(mandate, request, 500)).toBe(true);
    expect(mandateAllows({ ...mandate, validUntil: 500 }, request, 500)).toBe(false);
    expect(mandateAllows(mandate, { ...request, serviceId: "other@1" }, 500)).toBe(false);
    expect(mandateAllows(mandate, { ...request, amount: "5000001" }, 500)).toBe(false);
    expect(mandateAllows(mandate, { ...request, dataClass: 1 }, 500)).toBe(false);
  });
});
