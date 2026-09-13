import { z } from "zod";

const geocodingLocationSchema = z.object({
  name: z.string().min(1),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  country_code: z.string().min(2).max(2).optional(),
});

const geocodingResponseSchema = z.object({
  results: z.array(geocodingLocationSchema),
});

const forecastResponseSchema = z.object({
  current: z.object({
    time: z.string().min(1),
    temperature_2m: z.number().finite(),
    weather_code: z.number().int(),
  }),
});

export type WeatherResult = {
  city: string;
  countryCode?: string;
  condition: string;
  temperatureC: number;
  weatherCode: number;
  observedAt: string;
  source: "open-meteo";
};

export type WeatherLookupOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type WeatherLookup = (city: string, options?: WeatherLookupOptions) => Promise<WeatherResult>;

export type WeatherErrorCode = "invalid_city" | "city_not_found" | "upstream_unavailable" | "invalid_upstream_response";

export class WeatherLookupError extends Error {
  constructor(readonly code: WeatherErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WeatherLookupError";
  }
}

const WMO_CONDITIONS: ReadonlyArray<readonly [number, number, string]> = [
  [0, 0, "clear sky"],
  [1, 3, "partly cloudy"],
  [45, 48, "foggy"],
  [51, 57, "drizzle"],
  [61, 67, "rain"],
  [71, 77, "snow"],
  [80, 82, "rain showers"],
  [85, 86, "snow showers"],
  [95, 95, "thunderstorm"],
  [96, 99, "thunderstorm with hail"],
];

export function conditionForWmoCode(code: number): string {
  return WMO_CONDITIONS.find(([minimum, maximum]) => code >= minimum && code <= maximum)?.[2] ?? "unknown";
}

function cleanCity(city: string): string {
  const cleaned = city.trim();
  if (!cleaned) throw new WeatherLookupError("invalid_city", "city is required");
  if (cleaned.length > 120) throw new WeatherLookupError("invalid_city", "city is too long");
  return cleaned;
}

function timeoutMs(options?: WeatherLookupOptions): number {
  const value = options?.timeoutMs ?? 8_000;
  if (!Number.isSafeInteger(value) || value < 1 || value > 30_000) throw new Error("weather timeout must be 1-30000 milliseconds");
  return value;
}

async function getJson(url: URL, options?: WeatherLookupOptions): Promise<unknown> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs(options)) });
  } catch (error) {
    throw new WeatherLookupError("upstream_unavailable", "weather upstream is unavailable", { cause: error });
  }
  if (!response.ok) throw new WeatherLookupError("upstream_unavailable", `weather upstream returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new WeatherLookupError("invalid_upstream_response", "weather upstream returned invalid JSON", { cause: error });
  }
}

async function geocode(city: string, options?: WeatherLookupOptions) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: city, count: "1", language: "en", format: "json" }).toString();
  const parsed = geocodingResponseSchema.safeParse(await getJson(url, options));
  if (!parsed.success) throw new WeatherLookupError("invalid_upstream_response", "geocoding response did not match the expected shape");
  const location = parsed.data.results[0];
  if (!location) throw new WeatherLookupError("city_not_found", `no location found for ${city}`);
  return location;
}

export const lookupOpenMeteoWeather: WeatherLookup = async (requestedCity, options) => {
  const city = cleanCity(requestedCity);
  const location = await geocode(city, options);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,weather_code",
    timezone: "auto",
  }).toString();
  const parsed = forecastResponseSchema.safeParse(await getJson(url, options));
  if (!parsed.success) throw new WeatherLookupError("invalid_upstream_response", "forecast response did not match the expected shape");
  return {
    city: location.name,
    ...(location.country_code ? { countryCode: location.country_code } : {}),
    condition: conditionForWmoCode(parsed.data.current.weather_code),
    temperatureC: parsed.data.current.temperature_2m,
    weatherCode: parsed.data.current.weather_code,
    observedAt: parsed.data.current.time,
    source: "open-meteo",
  };
};
