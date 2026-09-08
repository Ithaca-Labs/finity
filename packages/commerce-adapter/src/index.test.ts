import { describe, expect, it } from "vitest";
import { encodePaymentResponseHeader } from "@x402/core/http";
import { CommerceError, assertAuthorizedChallenge, settlementTransaction } from "./index.js";
import type { Quote } from "@finity/schemas";

const quote: Quote = {
  kind: "finity.quote", serviceId: "hello-weather@1", methodId: "GET:/weather", manifestHash: `0x${"01".repeat(32)}`,
  requestClass: { unit: "call", units: "1" }, amount: "5000000", asset: "0.0.0", network: "hedera:testnet", payTo: "0.0.1234",
  nonce: "00000000-0000-4000-8000-000000000001", issuedAt: 100, expiresAt: 200, signature: `0x${"11".repeat(65)}`,
};
describe("commerce adapter", () => {
  it("rejects a challenge that changes payTo", () => {
    expect(() => assertAuthorizedChallenge({ scheme: "exact", network: "hedera:testnet", amount: "5000000", asset: "0.0.0", payTo: "0.0.999", extra: { feePayer: "0.0.1" } }, quote)).toThrow(CommerceError);
  });

  it("extracts the x402 settlement transaction", () => {
    const encoded = encodePaymentResponseHeader({ success: true, transaction: "0.0.1-1-2", network: "hedera:testnet", payer: "0.0.2" });
    const response = new Response("ok", { headers: { "PAYMENT-RESPONSE": encoded } });
    expect(settlementTransaction(response)).toBe("0.0.1-1-2");
  });
});
