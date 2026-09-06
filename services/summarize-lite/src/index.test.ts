import { describe, expect, it } from "vitest";
import { SUMMARIZATION_REQUEST_PRICE_TINYBAR, summarizeLiteManifest } from "./index.js";

describe("summarize-lite manifest", () => {
  it("describes one 1,000-character Hedera unit", () => {
    expect(summarizeLiteManifest.serviceId).toBe("summarize-lite@1");
    expect(summarizeLiteManifest.pricing).toMatchObject({ model: "per_unit", unit: "char", network: "hedera:testnet" });
    expect(SUMMARIZATION_REQUEST_PRICE_TINYBAR).toBe("1000000");
  });
});
