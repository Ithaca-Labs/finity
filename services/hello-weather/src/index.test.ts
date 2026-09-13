import { describe, expect, it } from "vitest";
import { helloWeatherManifest, lookupOpenMeteoWeather, WeatherLookupError } from "./index.js";

describe("hello-weather manifest", () => {
  it("describes a fixed-price Hedera service", () => {
    expect(helloWeatherManifest.serviceId).toBe("hello-weather@1");
    expect(helloWeatherManifest.pricing).toMatchObject({ model: "fixed", unit: "call", network: "hedera:testnet" });
  });

  it("looks up the requested city through geocoding and current forecast endpoints", async () => {
    const urls: string[] = [];
    const responses = [
      new Response(JSON.stringify({ results: [{ name: "London", latitude: 51.5, longitude: -0.1, country_code: "GB" }] }), { status: 200 }),
      new Response(JSON.stringify({ current: { time: "2026-09-13T10:15", temperature_2m: 18.9, weather_code: 51 } }), { status: 200 }),
    ];
    const result = await lookupOpenMeteoWeather("London", {
      fetchImpl: (async (input) => {
        urls.push(String(input));
        return responses.shift()!;
      }) as typeof fetch,
    });

    expect(result).toEqual({
      city: "London", countryCode: "GB", condition: "drizzle", temperatureC: 18.9,
      weatherCode: 51, observedAt: "2026-09-13T10:15", source: "open-meteo",
    });
    expect(new URL(urls[0]!).searchParams.get("name")).toBe("London");
    expect(new URL(urls[1]!).searchParams.get("current")).toBe("temperature_2m,weather_code");
  });

  it("fails closed when a city is not found", async () => {
    await expect(lookupOpenMeteoWeather("Atlantis", {
      fetchImpl: (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as typeof fetch,
    })).rejects.toMatchObject<Partial<WeatherLookupError>>({ code: "city_not_found" });
  });

  it("rejects malformed upstream data and transport failures", async () => {
    await expect(lookupOpenMeteoWeather("London", {
      fetchImpl: (async () => new Response(JSON.stringify({ nope: true }), { status: 200 })) as typeof fetch,
    })).rejects.toMatchObject<Partial<WeatherLookupError>>({ code: "invalid_upstream_response" });

    await expect(lookupOpenMeteoWeather("London", {
      fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch,
    })).rejects.toMatchObject<Partial<WeatherLookupError>>({ code: "upstream_unavailable" });
  });

  it("rejects an empty city before making a request", async () => {
    await expect(lookupOpenMeteoWeather("   ", { fetchImpl: (async () => new Response()) as typeof fetch }))
      .rejects.toMatchObject<Partial<WeatherLookupError>>({ code: "invalid_city" });
  });
});
