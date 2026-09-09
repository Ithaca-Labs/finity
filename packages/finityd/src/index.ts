import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { discover, quote, type QuoteFetcher } from "@finity/negotiator";
import type { MirrorFetcher, RegistryRecord } from "@finity/registry-client";
import { reducePurchase, requestClassSchema, revocationSchema, signature as signatureSchema, signedAgentMandateSchema, type Hash, type PurchaseEvent, type PurchaseState, type Revocation } from "@finity/schemas";
import { EscalationStore, type ProposedAmendment } from "./escalation-store.js";
import type { MandateStore } from "./executor.js";

export { EscalationStore } from "./escalation-store.js";
export type { Escalation, EscalationStatus, ProposedAmendment } from "./escalation-store.js";

export const INTENT_ROUTE_ALLOWLIST = new Set([
  "POST /v1/intents", "GET /v1/services", "POST /v1/quotes", "POST /v1/escalations",
  "GET /v1/escalations", "GET /v1/health", "POST /v1/mandates", "POST /v1/mandates/register",
  "POST /v1/mandates/revoke", "GET /v1/broker", "POST /v1/broker/withdraw",
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
  /** Full scan; fine for a single-broker local store. Used to find a purchase by the receiptId inside its refusal, which has no index of its own. */
  list(): Purchase[] {
    const rows = this.db.prepare("SELECT id FROM purchases").all() as { id: string }[];
    return rows.map((row) => this.get(row.id)).filter((purchase): purchase is Purchase => purchase !== undefined);
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
  registryRecord?(mandateId: Hash): Promise<RegistryRecord>;
};

export type BrokerAccountDependencies = {
  address: `0x${string}`;
  spendAccountId: string;
  getBalanceTinybar(): Promise<string>;
  withdrawToPrincipal(input: { destination: `0x${string}`; amountTinybar: string }): Promise<{
    transactionHash: string;
    destination: `0x${string}`;
    amountTinybar: string;
    feeTinybar: string;
  }>;
};

export type MandateRegistrationDependencies = {
  register(mandate: import("@finity/schemas").SignedAgentMandate): Promise<Record<string, unknown>>;
};

export type MandateRevocationDependencies = {
  revoke(revocation: Revocation, signature: `0x${string}`): Promise<Record<string, unknown>>;
};

/** Starts a localhost-only, bearer-protected API. No route can decrypt, sign, or broadcast arbitrary caller data. */
export function startFinityd(options: { store?: PurchaseStore; executor?: IntentExecutor; services?: ServicesDependencies; brokerAccount?: BrokerAccountDependencies; mandateRegistration?: MandateRegistrationDependencies; mandateRevocation?: MandateRevocationDependencies; escalations?: EscalationStore; token?: string; host?: "127.0.0.1" | "::1"; port?: number; killSwitchPath?: string } = {}): Finityd {
  const store = options.store ?? new PurchaseStore(); const token = options.token ?? randomBytes(32).toString("base64url");
  const escalations = options.escalations ?? new EscalationStore();
  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET"; const url = new URL(request.url ?? "/", "http://localhost"); const key = `${method} ${url.pathname}`;
      if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: "unauthorized" });
      if (method === "GET" && /^\/v1\/intents\/[0-9a-f-]+$/i.test(url.pathname)) { const purchase = store.get(url.pathname.split("/").at(-1)!); return purchase ? json(response, 200, purchase) : json(response, 404, { error: "not_found" }); }
      if (method === "GET" && /^\/v1\/receipts\/[a-zA-Z0-9x.-]+$/.test(url.pathname)) return json(response, 501, { error: "day2_dependency_unavailable" });
      if (method === "GET" && /^\/v1\/mandates\/0x[0-9a-fA-F]{64}$/.test(url.pathname)) {
        if (!options.services) return json(response, 501, { error: "day2_dependency_unavailable" });
        const record = options.services.mandateStore.get(url.pathname.split("/").at(-1) as Hash);
        return record ? json(response, 200, record.mandate) : json(response, 404, { error: "mandate_not_found" });
      }
      if (method === "GET" && /^\/v1\/mandates\/0x[0-9a-fA-F]{64}\/status$/.test(url.pathname)) {
        if (!options.services?.registryRecord) return json(response, 501, { error: "mandate_status_unavailable" });
        const mandateId = url.pathname.split("/").at(-2) as Hash;
        const mandate = options.services.mandateStore.get(mandateId);
        if (!mandate) return json(response, 404, { error: "mandate_not_found" });
        try {
          return json(response, 200, { mandate: mandate.mandate, record: await options.services.registryRecord(mandateId) });
        } catch {
          return json(response, 502, { error: "mandate_status_failed" });
        }
      }
      if (method === "POST" && /^\/v1\/escalations\/[0-9a-f-]+\/resolve$/i.test(url.pathname)) {
        const escalationId = url.pathname.split("/").at(-2)!;
        const body = (await readBody(request)) as { status?: string };
        if (body.status !== "APPROVED" && body.status !== "REJECTED") return json(response, 400, { error: "invalid_status" });
        const resolved = escalations.resolve(escalationId, body.status);
        return resolved ? json(response, 200, resolved) : json(response, 404, { error: "escalation_not_found" });
      }
      if (!INTENT_ROUTE_ALLOWLIST.has(key)) return json(response, 404, { error: "route_not_allowed" });
      if (key === "GET /v1/health") {
        const killSwitchActive = Boolean(options.killSwitchPath && existsSync(options.killSwitchPath));
        return json(response, 200, { status: "ok", killSwitchActive });
      }
      if (key === "GET /v1/broker") {
        if (!options.brokerAccount) return json(response, 501, { error: "broker_account_unavailable" });
        try {
          return json(response, 200, {
            address: options.brokerAccount.address,
            spendAccountId: options.brokerAccount.spendAccountId,
            balanceTinybar: await options.brokerAccount.getBalanceTinybar(),
          });
        } catch {
          return json(response, 502, { error: "broker_balance_failed" });
        }
      }
      if (key === "POST /v1/broker/withdraw") {
        if (!options.brokerAccount || !options.services?.registryRecord) return json(response, 501, { error: "broker_withdrawal_unavailable" });
        const body = (await readBody(request)) as { mandateId?: unknown; amountTinybar?: unknown };
        if (typeof body.mandateId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.mandateId) || typeof body.amountTinybar !== "string" || !/^[1-9][0-9]*$/.test(body.amountTinybar)) {
          return json(response, 400, { error: "invalid_withdrawal" });
        }
        const mandateId = body.mandateId as Hash;
        if (!options.services.mandateStore.get(mandateId)) return json(response, 404, { error: "mandate_not_found" });
        try {
          const record = await options.services.registryRecord(mandateId);
          if (record.broker.toLowerCase() !== options.brokerAccount.address.toLowerCase()) return json(response, 403, { error: "broker_mismatch" });
          return json(response, 200, await options.brokerAccount.withdrawToPrincipal({ destination: record.principal, amountTinybar: body.amountTinybar }));
        } catch {
          return json(response, 502, { error: "broker_withdrawal_failed" });
        }
      }
      if (key === "POST /v1/intents") {
        if (options.killSwitchPath && existsSync(options.killSwitchPath)) return json(response, 503, { error: "kill_switch_active" });
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
      if (key === "POST /v1/escalations") {
        const body = (await readBody(request)) as { receiptId?: string };
        if (typeof body.receiptId !== "string") return json(response, 400, { error: "invalid_request" });
        const purchase = store.list().find((candidate) => (candidate.refusal as { receiptId?: string } | undefined)?.receiptId === body.receiptId);
        if (!purchase) return json(response, 404, { error: "receipt_not_found" });
        const refusal = purchase.refusal as { decision?: string; proposedAmendment?: unknown } | undefined;
        if (refusal?.decision !== "ESCALATION_REQUIRED" || !refusal.proposedAmendment) return json(response, 400, { error: "not_escalatable" });
        const escalation = escalations.create({
          correlationId: purchase.correlationId, mandateId: purchase.intent.mandateId,
          receiptId: body.receiptId as Hash, proposedAmendment: refusal.proposedAmendment as ProposedAmendment,
        });
        return json(response, 200, { escalationId: escalation.escalationId, proposal: escalation.proposedAmendment });
      }
      if (key === "GET /v1/escalations") return json(response, 200, { escalations: escalations.listPending() });
      if (key === "POST /v1/mandates/register") {
        if (!options.services || !options.mandateRegistration) return json(response, 501, { error: "registration_unavailable" });
        const parsed = signedAgentMandateSchema.safeParse(await readBody(request));
        if (!parsed.success) return json(response, 400, { error: "invalid_mandate" });
        const registered = await options.mandateRegistration.register(parsed.data);
        options.services.mandateStore.set(parsed.data.mandateId as Hash, parsed.data);
        return json(response, 201, registered);
      }
      if (key === "POST /v1/mandates/revoke") {
        if (!options.mandateRevocation) return json(response, 501, { error: "revocation_unavailable" });
        const body = (await readBody(request)) as { revocation?: unknown; signature?: unknown };
        const revocation = revocationSchema.safeParse(body.revocation);
        const signature = signatureSchema.safeParse(body.signature);
        if (!revocation.success || !signature.success) return json(response, 400, { error: "invalid_revocation" });
        try {
          return json(response, 201, await options.mandateRevocation.revoke(revocation.data, signature.data as `0x${string}`));
        } catch {
          return json(response, 502, { error: "revocation_failed" });
        }
      }
      if (key === "POST /v1/mandates") {
        // Loads a mandate into the live MandateStore without a restart - needed
        // after /finity mandate new or an approved escalation's successor
        // mandate. Same trust level as the whole bearer-token-gated local API
        // and the ~/.finity/mandates/*.json files this daemon already loads
        // unverified at boot: no real signature/on-chain verification gates
        // this either, since that scheme is still undecided (@finity/verifier's
        // job). Not a new privilege beyond what already holding the token or
        // filesystem access implies, but worth tightening once that scheme exists.
        if (!options.services) return json(response, 501, { error: "day2_dependency_unavailable" });
        const parsed = signedAgentMandateSchema.safeParse(await readBody(request));
        if (!parsed.success) return json(response, 400, { error: "invalid_mandate" });
        options.services.mandateStore.set(parsed.data.mandateId as Hash, parsed.data);
        return json(response, 201, { mandateId: parsed.data.mandateId });
      }
      return json(response, 501, { error: "day2_dependency_unavailable" });
    } catch { return json(response, 400, { error: "invalid_request" }); }
  });
  server.listen(options.port ?? 0, options.host ?? "127.0.0.1");
  return { token, server, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

export * from "./executor.js";
export * from "./live-dependencies.js";
