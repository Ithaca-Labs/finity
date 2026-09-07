import { afterEach, describe, expect, it } from "vitest";
import { helloWeatherManifest } from "@finity/hello-weather";
import { loadProviderRuntime } from "./provider-runtime.js";

const original = { ...process.env };
const testKey = `0x${"11".repeat(32)}`;

afterEach(() => {
  process.env = { ...original };
});

function configureProvider(url: string): void {
  process.env.FINITY_PROVIDER_A_URL = url;
  process.env.FINITY_PROVIDER_A_ACCOUNT = "0.0.1234";
  process.env.FINITY_PROVIDER_A_SIGNING_EVM_PRIVATE_KEY = testKey;
  process.env.FINITY_PROVIDER_A_PORT = "3001";
}

describe("provider runtime", () => {
  it("builds a signed local-development manifest without retaining the private key", async () => {
    configureProvider("http://localhost:3001");
    const runtime = await loadProviderRuntime("A", helloWeatherManifest);
    expect(runtime.manifest.payTo).toBe("0.0.1234");
    expect(runtime.manifest.baseUrl).toBe("http://localhost:3001");
    expect(runtime.manifest.provider.signingKey).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(runtime.manifest.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(JSON.stringify(runtime)).not.toContain(testKey);
  });

  it("fails closed for a non-local HTTP provider origin", async () => {
    configureProvider("http://weather.example");
    await expect(loadProviderRuntime("A", helloWeatherManifest)).rejects.toThrow("must use HTTPS");
  });
});
