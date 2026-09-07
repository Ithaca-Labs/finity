import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export class FinitydError extends Error {
  constructor(readonly status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FinitydError";
  }
}

export type FinitydRuntimeInfo = { baseUrl: string; token: string };

export function defaultRuntimeInfoPath(): string {
  return join(homedir(), ".finity", "finityd.runtime.json");
}

/** Reads where the running finityd is and its bearer token, written by the finityd daemon at startup. */
export async function loadFinitydRuntimeInfo(path: string = defaultRuntimeInfoPath()): Promise<FinitydRuntimeInfo> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new FinitydError(0, "finityd is not running (no runtime info file found); start it with `finity broker` or `finity`.", { cause: error });
  }
  const parsed = JSON.parse(raw) as Partial<FinitydRuntimeInfo>;
  if (typeof parsed.baseUrl !== "string" || typeof parsed.token !== "string") {
    throw new FinitydError(0, "finityd runtime info file is malformed");
  }
  return { baseUrl: parsed.baseUrl, token: parsed.token };
}

export type Intent = {
  mandateId: string;
  agentUaid: string;
  serviceHint?: string;
  methodId?: string;
  requestClass: { unit: string; units: string };
  payloadRef: string;
  dataClass: number;
  constraints?: { maxLatencyMs?: number; preferCheapest?: boolean };
};

/**
 * Thin client over finityd's localhost intent API (FINITY_BUILD_SPEC.md
 * section 8.9). Every method maps to exactly one allowlisted route - there
 * is no method that can decrypt, sign, or broadcast an arbitrary payload,
 * because finityd itself exposes no such route.
 */
export class FinitydClient {
  constructor(private readonly config: { baseUrl: string; token: string; fetchImpl?: typeof fetch }) {}

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const response = await fetchImpl(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `finityd returned HTTP ${response.status}`;
      throw new FinitydError(response.status, message);
    }
    return payload;
  }

  health(): Promise<{ status: string }> {
    return this.request("GET", "/v1/health") as Promise<{ status: string }>;
  }

  createIntent(intent: Intent): Promise<{ correlationId: string; status: string }> {
    return this.request("POST", "/v1/intents", intent) as Promise<{ correlationId: string; status: string }>;
  }

  getIntent(correlationId: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/v1/intents/${encodeURIComponent(correlationId)}`) as Promise<Record<string, unknown>>;
  }

  listServices(mandateId: string): Promise<{ manifests: unknown[] }> {
    return this.request("GET", `/v1/services?mandateId=${encodeURIComponent(mandateId)}`) as Promise<{ manifests: unknown[] }>;
  }

  requestQuotes(input: { mandateId: string; serviceId: string; methodId: string; requestClass: { unit: string; units: string } }): Promise<{ quotes: unknown[] }> {
    return this.request("POST", "/v1/quotes", input) as Promise<{ quotes: unknown[] }>;
  }

  requestEscalation(receiptId: string): Promise<Record<string, unknown>> {
    return this.request("POST", "/v1/escalations", { receiptId }) as Promise<Record<string, unknown>>;
  }

  listEscalations(): Promise<{ escalations: unknown[] }> {
    return this.request("GET", "/v1/escalations") as Promise<{ escalations: unknown[] }>;
  }
}
