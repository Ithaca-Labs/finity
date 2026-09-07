import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { discover, quote, type QuoteFetcher } from "@finity/negotiator";
import type { MirrorFetcher } from "@finity/registry-client";
import { reducePurchase, requestClassSchema, type Hash, type PurchaseEvent, type PurchaseState } from "@finity/schemas";
import type { MandateStore } from "./executor.js";

export const INTENT_ROUTE_ALLOWLIST = new Set([
  "POST /v1/intents", "GET /v1/services", "POST /v1/quotes", "POST /v1/escalations",
  "GET /v1/escalations", "GET /v1/health",
]);

export type Intent = {
  mandateId: Hash; agentUaid: string; serviceHint?: string; methodId?: string;
  requestClass: { unit: string; units: string }; payloadRef: string; dataClass: number;
  constraints?: { maxLatencyMs?: number; preferCheapest?: boolean };
};
export type Purchase = { correlationId: string; state: PurchaseState; intent: Intent; result?: unknown; refusal?: unknown; updatedAt: number };
export type Transition = (event: PurchaseEvent, extra?: Pick<Purchase, "result" | "refusal">) => Purchase;
export type IntentExecutor = (purchase: Purchase, transition: Transition) => Promise<void>;

function parseIntent(value: unknown): Intent {
  const data = value as Partial<Intent>;
  const dataClass = data?.dataClass;
  if (
    !data
    || typeof data.mandateId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data.mandateId)
    || typeof data.agentUaid !== "string" || !data.agentUaid
    || typeof data.payloadRef !== "string" || !data.payloadRef
    || !data.requestClass || typeof data.requestClass.unit !== "string" || !/^(0|[1-9][0-9]*)$/.test(data.requestClass.units ?? "")
    || typeof dataClass !== "number" || !Number.isInteger(dataClass) || dataClass < 0 || dataClass > 2
  ) {
    throw new Error("invalid intent");
  }
  return data as Intent;
}

/** SQLite-backed purchase state. Payloads are references only: secrets and raw prompts never enter this database. */
export class PurchaseStore {
  private readonly db: Database.Database;
  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, state TEXT NOT NULL, intent TEXT NOT NULL, result TEXT, refusal TEXT, updated_at INTEGER NOT NULL)");
  }
  create(intent: Intent): Purchase {
    const purchase: Purchase = { correlationId: randomUUID(), state: "INTENT", intent, updatedAt: Math.floor(Date.now() / 1000) };
    this.db.prepare("INSERT INTO purchases VALUES (?, ?, ?, NULL, NULL, ?)").run(purchase.correlationId, purchase.state, JSON.stringify(intent), purchase.updatedAt);
    return purchase;
  }
  get(id: string): Purchase | undefined {
    const row = this.db.prepare("SELECT * FROM purchases WHERE id = ?").get(id) as { id: string; state: PurchaseState; intent: string; result: string | null; refusal: string | null; updated_at: number } | undefined;
    return row && { correlationId: row.id, state: row.state, intent: JSON.parse(row.intent), ...(row.result ? { result: JSON.parse(row.result) } : {}), ...(row.refusal ? { refusal: JSON.parse(row.refusal) } : {}), updatedAt: row.updated_at };
  }
  transition(id: string, event: PurchaseEvent, extra: Pick<Purchase, "result" | "refusal"> = {}): Purchase {
    const current = this.get(id); if (!current) throw new Error("purchase not found");
    const state = reducePurchase(current.state, event); const updatedAt = Math.floor(Date.now() / 1000);
    this.db.prepare("UPDATE purchases SET state = ?, result = COALESCE(?, result), refusal = COALESCE(?, refusal), updated_at = ? WHERE id = ?")
      .run(state, extra.result === undefined ? null : JSON.stringify(extra.result), extra.refusal === undefined ? null : JSON.stringify(extra.refusal), updatedAt, id);
    return this.get(id)!;
  }
  close(): void { this.db.close(); }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(body));
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export type Finityd = { token: string; server: Server; close(): Promise<void> };

/** Backs GET /v1/services and POST /v1/quotes with the same mandate-scoped discovery/negotiation the purchase executor uses. */
export type ServicesDependencies = {
  mandateStore: MandateStore;
  topicId: string;
  mirrorNodeUrl?: string;
  mirrorFetcher?: MirrorFetcher;
  quoteFetcher?: QuoteFetcher;
  now?(): number;
};

/** Starts a localhost-only, bearer-protected API. No route can decrypt, sign, or broadcast arbitrary caller data. */
export function startFinityd(options: { store?: PurchaseStore; executor?: IntentExecutor; services?: ServicesDependencies; token?: string; host?: "127.0.0.1" | "::1"; port?: number } = {}): Finityd {
  const store = options.store ?? new PurchaseStore(); const token = options.token ?? randomBytes(32).toString("base64url");
  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET"; const url = new URL(request.url ?? "/", "http://localhost"); const key = `${method} ${url.pathname}`;
      if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: "unauthorized" });
      if (method === "GET" && /^\/v1\/intents\/[0-9a-f-]+$/i.test(url.pathname)) { const purchase = store.get(url.pathname.split("/").at(-1)!); return purchase ? json(response, 200, purchase) : json(response, 404, { error: "not_found" }); }
      if (method === "GET" && /^\/v1\/(mandates|receipts)\/[a-zA-Z0-9x.-]+$/.test(url.pathname)) return json(response, 501, { error: "day2_dependency_unavailable" });
      if (!INTENT_ROUTE_ALLOWLIST.has(key)) return json(response, 404, { error: "route_not_allowed" });
      if (key === "GET /v1/health") return json(response, 200, { status: "ok" });
      if (key === "POST /v1/intents") {
        const purchase = store.create(parseIntent(await readBody(request)));
        if (options.executor) {
          void options.executor(purchase, (event, extra) => store.transition(purchase.correlationId, event, extra))
            .catch(() => store.transition(purchase.correlationId, { type: "FAILED_EVALUATION" }));
        }
        return json(response, 202, { correlationId: purchase.correlationId, status: purchase.state });
      }
      if (key === "GET /v1/services") {
        if (!options.services) return json(response, 501, { error: "day2_dependency_unavailable" });
        const mandateId = url.searchParams.get("mandateId");
        if (!mandateId) return json(response, 400, { error: "mandateId is required" });
        const record = options.services.mandateStore.get(mandateId as Hash);
        if (!record) return json(response, 404, { error: "mandate_not_found" });
        try {
          const manifests = await discover(
            { allowedServices: record.mandate.allowedServices, allowedMethods: record.mandate.allowedMethods },
            { topicId: options.services.topicId, mirrorNodeUrl: options.services.mirrorNodeUrl, fetcher: options.services.mirrorFetcher },
          );
          return json(response, 200, { manifests });
        } catch {
          return json(response, 502, { error: "discovery_failed" });
        }
      }
      if (key === "POST /v1/quotes") {
        if (!options.services) return json(response, 501, { error: "day2_dependency_unavailable" });
        const body = (await readBody(request)) as { mandateId?: string; serviceId?: string; methodId?: string; requestClass?: unknown };
        if (typeof body.mandateId !== "string" || typeof body.serviceId !== "string" || typeof body.methodId !== "string") {
          return json(response, 400, { error: "invalid_request" });
        }
        const requestClass = requestClassSchema.safeParse(body.requestClass);
        if (!requestClass.success) return json(response, 400, { error: "invalid_request_class" });
        const record = options.services.mandateStore.get(body.mandateId as Hash);
        if (!record) return json(response, 404, { error: "mandate_not_found" });
        try {
          const manifests = await discover(
            { allowedServices: record.mandate.allowedServices, allowedMethods: record.mandate.allowedMethods, serviceHint: body.serviceId },
            { topicId: options.services.topicId, mirrorNodeUrl: options.services.mirrorNodeUrl, fetcher: options.services.mirrorFetcher },
          );
          const manifest = manifests[0];
          if (!manifest) return json(response, 404, { error: "service_not_found" });
          const now = options.services.now?.() ?? Math.floor(Date.now() / 1000);
          const offeredQuote = await quote(manifest, body.methodId, requestClass.data, { now, fetcher: options.services.quoteFetcher });
          return json(response, 200, { quotes: [offeredQuote] });
        } catch {
          return json(response, 502, { error: "quote_failed" });
        }
      }
      return json(response, 501, { error: "day2_dependency_unavailable" });
    } catch { return json(response, 400, { error: "invalid_request" }); }
  });
  server.listen(options.port ?? 0, options.host ?? "127.0.0.1");
  return { token, server, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

export * from "./executor.js";
export * from "./live-dependencies.js";
