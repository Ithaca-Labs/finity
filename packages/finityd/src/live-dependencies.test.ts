import { describe, expect, it } from "vitest";
import { parsePaymentChallenges, defaultResourceUrl } from "./live-dependencies.js";
import type { Intent } from "./index.js";
import type { ServiceManifest } from "@finity/schemas";

const accepts = [{ scheme: "exact", network: "hedera:testnet", amount: "5000000", asset: "0.0.0", payTo: "0.0.1", extra: { feePayer: "0.0.2" } }];

describe("parsePaymentChallenges", () => {
  it("reads x402 v2 requirements from PAYMENT-REQUIRED", async () => {
    const encoded = Buffer.from(JSON.stringify({ x402Version: 2, accepts })).toString("base64");
    await expect(parsePaymentChallenges(new Response("{}", { headers: { "PAYMENT-REQUIRED": encoded } }))).resolves.toEqual(accepts);
  });

  it("accepts the legacy JSON body shape", async () => {
    await expect(parsePaymentChallenges(new Response(JSON.stringify({ accepts })))).resolves.toEqual(accepts);
  });
});

describe("default resource URLs", () => {
  const manifest = {
    serviceId: "hello-weather@1",
    baseUrl: "http://127.0.0.1:3001",
  } as ServiceManifest;

  it("uses the city carried by the purchase intent", () => {
    const intent = { payloadRef: "weather.current:New York" } as Intent;
    expect(defaultResourceUrl(manifest, "weather.current", intent)).toBe("http://127.0.0.1:3001/weather?city=New%20York");
  });

  it("fails closed when weather has no explicit city", () => {
    expect(() => defaultResourceUrl(manifest, "weather.current", { payloadRef: "weather.current:" } as Intent)).toThrow("payloadRef");
  });
});
