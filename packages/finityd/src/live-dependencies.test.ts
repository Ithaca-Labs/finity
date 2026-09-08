import { describe, expect, it } from "vitest";
import { parsePaymentChallenges } from "./live-dependencies.js";

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
