import { describe, expect, it } from "vitest";
import { helloWeatherManifest } from "./index.js";

describe("hello-weather manifest", () => {
  it("describes a fixed-price Hedera service", () => {
    expect(helloWeatherManifest.serviceId).toBe("hello-weather@1");
    expect(helloWeatherManifest.pricing).toMatchObject({ model: "fixed", unit: "call", network: "hedera:testnet" });
  });
});
