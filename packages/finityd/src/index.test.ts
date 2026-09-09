import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { compile } from "@finity/mandate-compiler";
import type { RegistryRecord } from "@finity/registry-client";
import type { Revocation, ServiceManifest, SignedAgentMandate } from "@finity/schemas";
import { MandateStore, PurchaseStore, startFinityd, type Finityd } from "./index.js";

let running: Finityd | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function baseUrl(instance: Finityd): Promise<string> {
  if (!instance.server.listening) await new Promise((resolve) => instance.server.once("listening", resolve));
  const address = instance.server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

describe("finityd HTTP API", () => {
  it("rejects requests without the bearer token", async () => {
    running = startFinityd();
    const response = await fetch(`${await baseUrl(running)}/v1/health`);
    expect(response.status).toBe(401);
  });

  it("reports health once authenticated", async () => {
    running = startFinityd();
    const response = await fetch(`${await baseUrl(running)}/v1/health`, { headers: { authorization: `Bearer ${running.token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", killSwitchActive: false });
  });

  it("threads the executor's result and refusal payloads back into the stored purchase", async () => {
    running = startFinityd({
      executor: async (purchase, transition) => {
        transition({ type: "DISCOVERED" });
        transition({ type: "QUOTED" });
        transition({ type: "EVALUATING" });
        transition({ type: "REFUSED" }, { refusal: { reasonCodes: ["SERVICE_NOT_ALLOWED"] } });
      },
    });
    const created = await fetch(`${await baseUrl(running)}/v1/intents`, {
      method: "POST",
      headers: { authorization: `Bearer ${running.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        mandateId: `0x${"01".repeat(32)}`,
        agentUaid: "did:aid:buyer",
        payloadRef: "ref://1",
        requestClass: { unit: "call", units: "1" },
        dataClass: 0,
      }),
    });
    expect(created.status).toBe(202);
    const { correlationId } = (await created.json()) as { correlationId: string };

    await new Promise((resolve) => setTimeout(resolve, 10));
    const fetched = await fetch(`${await baseUrl(running)}/v1/intents/${correlationId}`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(fetched.status).toBe(200);
    const purchase = await fetched.json();
    expect(purchase).toMatchObject({ state: "REFUSED", refusal: { reasonCodes: ["SERVICE_NOT_ALLOWED"] } });
  });
});

describe("kill switch", () => {
  it("refuses new intents while the kill-switch file exists, and reports it in health, without touching existing purchases", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finityd-kill-switch-"));
    const killSwitchPath = join(dir, "kill-switch");
    try {
      let executorCalled = false;
      running = startFinityd({ killSwitchPath, executor: async () => { executorCalled = true; } });
      const url = await baseUrl(running);
      const headers = { authorization: `Bearer ${running.token}` };

      const healthBefore = await fetch(`${url}/v1/health`, { headers });
      expect(await healthBefore.json()).toEqual({ status: "ok", killSwitchActive: false });

      writeFileSync(killSwitchPath, "");
      const healthDuring = await fetch(`${url}/v1/health`, { headers });
      expect(await healthDuring.json()).toEqual({ status: "ok", killSwitchActive: true });

      const blocked = await fetch(`${url}/v1/intents`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          mandateId: `0x${"01".repeat(32)}`, agentUaid: "did:aid:buyer", payloadRef: "ref://1",
          requestClass: { unit: "call", units: "1" }, dataClass: 0,
        }),
      });
      expect(blocked.status).toBe(503);
      expect(await blocked.json()).toEqual({ error: "kill_switch_active" });
      expect(executorCalled).toBe(false);

      rmSync(killSwitchPath);
      const allowed = await fetch(`${url}/v1/intents`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          mandateId: `0x${"01".repeat(32)}`, agentUaid: "did:aid:buyer", payloadRef: "ref://1",
          requestClass: { unit: "call", units: "1" }, dataClass: 0,
        }),
      });
      expect(allowed.status).toBe(202);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const compiled = compile({
  agent: "did:aid:buyer", broker: "0x1111111111111111111111111111111111111111", spendAccount: "0.0.123",
  allowedServices: "hello-weather@1", allowedMethods: "weather.current", asset: "HBAR",
  maxPerRequest: "5000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000",
  maxUnitsPerRequest: "0", validFrom: 1_788_739_200, validUntil: 1_790_208_000, quoteMaxAgeSeconds: "120",
  dataClass: 0, escalationRule: "anything above per-request cap needs my Ledger",
  policyHash: `0x${"aa".repeat(32)}`, nonce: "1", predecessor: `0x${"00".repeat(32)}`,
  verifyingContract: "0x2222222222222222222222222222222222222222",
});
const mandate: SignedAgentMandate = { ...compiled.canonicalMandate, signature: `0x${"bb".repeat(65)}`, mandateId: compiled.mandateId };
const liveRecord: RegistryRecord = {
  principal: `0x${"aa".repeat(20)}`,
  broker: `0x${"11".repeat(20)}`,
  policyHash: `0x${"cc".repeat(32)}`,
  limits: { maxPerRequest: "5000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000", validFrom: "1", validUntil: "2000000000" },
  lifetimeConsumed: "100000000",
  periodIndex: "1",
  periodConsumed: "50000000",
  reserved: "5000000",
  status: 1,
  successor: `0x${"00".repeat(32)}`,
  traceTopic: "0.0.456",
};
const manifest: ServiceManifest = {
  kind: "finity.manifest", version: 1, serviceId: "hello-weather@1",
  provider: { uaid: "did:aid:provider", hederaAccount: "0.0.789", signingKey: "provider-key" },
  name: "Hello Weather", description: "Current conditions.", baseUrl: "https://weather.example.test",
  methods: [{ id: "weather.current", inputSchemaRef: "in", outputSchemaRef: "out", dataClassMax: 0 }],
  pricing: { model: "fixed", unit: "call", asset: "0.0.0", network: "hedera:testnet" },
  quoteEndpoint: "/quote", payTo: "0.0.789", receiptKey: "receipt-key", healthEndpoint: "/health",
  publishedAt: 1_788_739_200, signature: `0x${"cc".repeat(65)}`,
};

describe("finityd HTTP API control-center routes", () => {
  it("returns live mandate consumption and status", async () => {
    const mandateStore = new MandateStore();
    mandateStore.set(compiled.mandateId, mandate);
    running = startFinityd({ services: {
      mandateStore, topicId: "0.0.1", registryRecord: async () => liveRecord,
    } });
    const response = await fetch(`${await baseUrl(running)}/v1/mandates/${compiled.mandateId}/status`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mandate, record: liveRecord });
  });

  it("returns broker balance and derives withdrawal destination from the mandate principal", async () => {
    const mandateStore = new MandateStore();
    mandateStore.set(compiled.mandateId, mandate);
    let received: { destination: string; amountTinybar: string } | undefined;
    running = startFinityd({
      services: { mandateStore, topicId: "0.0.1", registryRecord: async () => liveRecord },
      brokerAccount: {
        address: liveRecord.broker,
        spendAccountId: "0.0.123",
        getBalanceTinybar: async () => "500000000",
        withdrawToPrincipal: async (input) => {
          received = input;
          return { transactionHash: `0x${"dd".repeat(32)}`, ...input, feeTinybar: "1000" };
        },
      },
    });
    const url = await baseUrl(running);
    const headers = { authorization: `Bearer ${running.token}` };
    const broker = await fetch(`${url}/v1/broker`, { headers });
    expect(await broker.json()).toEqual({ address: liveRecord.broker, spendAccountId: "0.0.123", balanceTinybar: "500000000" });

    const withdrawal = await fetch(`${url}/v1/broker/withdraw`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ mandateId: compiled.mandateId, amountTinybar: "100000000" }),
    });
    expect(withdrawal.status).toBe(200);
    expect(received).toEqual({ destination: liveRecord.principal, amountTinybar: "100000000" });

    const malformed = await fetch(`${url}/v1/broker/withdraw`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ mandateId: compiled.mandateId, amountTinybar: "0" }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_withdrawal" });
  });

  it("refuses withdrawal when the mandate is bound to another broker", async () => {
    const mandateStore = new MandateStore();
    mandateStore.set(compiled.mandateId, mandate);
    running = startFinityd({
      services: { mandateStore, topicId: "0.0.1", registryRecord: async () => ({ ...liveRecord, broker: `0x${"22".repeat(20)}` }) },
      brokerAccount: {
        address: liveRecord.broker,
        spendAccountId: "0.0.123",
        getBalanceTinybar: async () => "500000000",
        withdrawToPrincipal: async () => { throw new Error("should not send"); },
      },
    });
    const response = await fetch(`${await baseUrl(running)}/v1/broker/withdraw`, {
      method: "POST",
      headers: { authorization: `Bearer ${running.token}`, "content-type": "application/json" },
      body: JSON.stringify({ mandateId: compiled.mandateId, amountTinybar: "100000000" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "broker_mismatch" });
  });
});

function mirrorFetcherWith(entries: unknown[]): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        messages: entries.map((entry, index) => ({
          consensus_timestamp: `${index}.0`, sequence_number: index,
          message: Buffer.from(JSON.stringify(entry), "utf8").toString("base64"),
          running_hash: null, transaction_id: null,
        })),
        links: { next: null },
      }),
      { status: 200 },
    )) as typeof fetch;
}

describe("finityd HTTP API services/quotes routes", () => {
  it("returns 501 when no services dependencies are configured", async () => {
    running = startFinityd();
    const response = await fetch(`${await baseUrl(running)}/v1/services?mandateId=${compiled.mandateId}`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(response.status).toBe(501);
  });

  it("discovers eligible manifests for a known mandate", async () => {
    const mandateStore = new MandateStore();
    mandateStore.set(compiled.mandateId, mandate);
    running = startFinityd({ services: { mandateStore, topicId: "0.0.1", mirrorFetcher: mirrorFetcherWith([manifest]) } });
    const response = await fetch(`${await baseUrl(running)}/v1/services?mandateId=${compiled.mandateId}`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ manifests: [{ serviceId: "hello-weather@1" }] });
  });

  it("404s discovery for an unknown mandate", async () => {
    running = startFinityd({ services: { mandateStore: new MandateStore(), topicId: "0.0.1", mirrorFetcher: mirrorFetcherWith([]) } });
    const response = await fetch(`${await baseUrl(running)}/v1/services?mandateId=${`0x${"99".repeat(32)}`}`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(response.status).toBe(404);
  });

  it("returns a signed quote for a known mandate, service, and method", async () => {
    const mandateStore = new MandateStore();
    mandateStore.set(compiled.mandateId, mandate);
    const quotePayload = {
      kind: "finity.quote", serviceId: "hello-weather@1", methodId: "weather.current",
      manifestHash: `0x${"dd".repeat(32)}`, requestClass: { unit: "call", units: "1" },
      amount: "5000000", asset: "0.0.0", network: "hedera:testnet", payTo: "0.0.789",
      nonce: "00000000-0000-4000-8000-000000000001", issuedAt: 100, expiresAt: 160, signature: `0x${"ee".repeat(65)}`,
    };
    running = startFinityd({
      services: {
        mandateStore, topicId: "0.0.1",
        mirrorFetcher: mirrorFetcherWith([manifest]),
        quoteFetcher: (async () => new Response(JSON.stringify(quotePayload), { status: 200 })) as typeof fetch,
        now: () => 100,
      },
    });
    const response = await fetch(`${await baseUrl(running)}/v1/quotes`, {
      method: "POST",
      headers: { authorization: `Bearer ${running.token}`, "content-type": "application/json" },
      body: JSON.stringify({ mandateId: compiled.mandateId, serviceId: "hello-weather@1", methodId: "weather.current", requestClass: { unit: "call", units: "1" } }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ quotes: [{ serviceId: "hello-weather@1", amount: "5000000" }] });
  });
});

describe("PurchaseStore on-disk persistence", () => {
  it("survives being reopened from the same file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "finityd-purchase-store-"));
    const dbPath = join(dir, "purchases.sqlite");
    try {
      const first = new PurchaseStore(dbPath);
      const purchase = first.create({
        mandateId: `0x${"01".repeat(32)}`, agentUaid: "did:aid:buyer", payloadRef: "ref://1",
        requestClass: { unit: "call", units: "1" }, dataClass: 0,
      });
      first.transition(purchase.correlationId, { type: "DISCOVERED" });
      first.close();

      const reopened = new PurchaseStore(dbPath);
      try {
        expect(reopened.get(purchase.correlationId)).toMatchObject({ state: "DISCOVERED" });
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("finityd HTTP API mandates routes", () => {
  it("returns 501 for GET/POST /v1/mandates when no services dependencies are configured", async () => {
    running = startFinityd();
    const headers = { authorization: `Bearer ${running.token}` };
    const url = await baseUrl(running);
    expect((await fetch(`${url}/v1/mandates/${compiled.mandateId}`, { headers })).status).toBe(501);
    expect((await fetch(`${url}/v1/mandates`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" })).status).toBe(501);
  });

  it("loads a mandate via POST and makes it immediately readable via GET, without a restart", async () => {
    const mandateStore = new MandateStore();
    running = startFinityd({ services: { mandateStore, topicId: "0.0.1" } });
    const url = await baseUrl(running);
    const headers = { authorization: `Bearer ${running.token}`, "content-type": "application/json" };

    const before = await fetch(`${url}/v1/mandates/${compiled.mandateId}`, { headers });
    expect(before.status).toBe(404);

    const created = await fetch(`${url}/v1/mandates`, { method: "POST", headers, body: JSON.stringify(mandate) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ mandateId: compiled.mandateId });
    expect(mandateStore.get(compiled.mandateId)?.mandate).toEqual(mandate);

    const after = await fetch(`${url}/v1/mandates/${compiled.mandateId}`, { headers });
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual(mandate);
  });

  it("rejects a malformed mandate body", async () => {
    running = startFinityd({ services: { mandateStore: new MandateStore(), topicId: "0.0.1" } });
    const url = await baseUrl(running);
    const headers = { authorization: `Bearer ${running.token}`, "content-type": "application/json" };
    const response = await fetch(`${url}/v1/mandates`, { method: "POST", headers, body: JSON.stringify({ not: "a mandate" }) });
    expect(response.status).toBe(400);
  });

  it("registers a signed mandate through the broker and loads it without restart", async () => {
    const mandateStore = new MandateStore();
    let received: SignedAgentMandate | undefined;
    running = startFinityd({
      services: { mandateStore, topicId: "0.0.1" },
      mandateRegistration: {
        register: async (input) => {
          received = input;
          return { mandateId: input.mandateId, registrationTx: `0x${"12".repeat(32)}`, traceTopicId: "0.0.9" };
        },
      },
    });
    const url = await baseUrl(running);
    const response = await fetch(`${url}/v1/mandates/register`, {
      method: "POST",
      headers: { authorization: `Bearer ${running.token}`, "content-type": "application/json" },
      body: JSON.stringify(mandate),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ mandateId: mandate.mandateId, traceTopicId: "0.0.9" });
    expect(received).toEqual(mandate);
    expect(mandateStore.get(compiled.mandateId)?.mandate).toEqual(mandate);
  });

  it("relays only a valid Ledger-signed revocation through the broker", async () => {
    const revocation = { mandateId: compiled.mandateId as `0x${string}`, nonce: "123", reason: "rotate broker" };
    const signature = `0x${"ab".repeat(65)}` as `0x${string}`;
    let received: { revocation: Revocation; signature: string } | undefined;
    running = startFinityd({
      mandateRevocation: {
        revoke: async (input, inputSignature) => {
          received = { revocation: input, signature: inputSignature };
          return { mandateId: input.mandateId, status: "REVOKED", revocationTx: `0x${"12".repeat(32)}` };
        },
      },
    });
    const url = await baseUrl(running);
    const headers = { authorization: `Bearer ${running.token}`, "content-type": "application/json" };
    const response = await fetch(`${url}/v1/mandates/revoke`, {
      method: "POST", headers, body: JSON.stringify({ revocation, signature }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ mandateId: compiled.mandateId, status: "REVOKED" });
    expect(received).toEqual({ revocation, signature });

    const malformed = await fetch(`${url}/v1/mandates/revoke`, {
      method: "POST", headers, body: JSON.stringify({ revocation: { ...revocation, nonce: "-1" }, signature }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_revocation" });
  });

  it("reports broker relay failure without accepting the revocation", async () => {
    running = startFinityd({ mandateRevocation: { revoke: async () => { throw new Error("relay failed"); } } });
    const response = await fetch(`${await baseUrl(running)}/v1/mandates/revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${running.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        revocation: { mandateId: compiled.mandateId, nonce: "123", reason: "rotate broker" },
        signature: `0x${"ab".repeat(65)}`,
      }),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "revocation_failed" });
  });
});

describe("finityd HTTP API escalation routes", () => {
  const proposedAmendment = {
    field: 0, newValue: "6000000", newValueText: "0.06 HBAR", scopeServiceId: "hello-weather@1",
    oneTime: true, validUntil: 2_000_000_000, nonce: "1",
  };

  async function startWithEscalatedPurchase() {
    running = startFinityd({
      executor: async (purchase, transition) => {
        transition({ type: "DISCOVERED" });
        transition({ type: "QUOTED" });
        transition({ type: "EVALUATING" });
        transition(
          { type: "ESCALATION_REQUIRED" },
          { refusal: { decision: "ESCALATION_REQUIRED", reasonCodes: ["PRICE_LIMIT_EXCEEDED"], receiptId: `0x${"aa".repeat(32)}`, proposedAmendment } },
        );
      },
    });
    const url = await baseUrl(running);
    const headers = { authorization: `Bearer ${running.token}`, "content-type": "application/json" };
    const created = await fetch(`${url}/v1/intents`, {
      method: "POST", headers,
      body: JSON.stringify({
        mandateId: `0x${"01".repeat(32)}`, agentUaid: "did:aid:buyer", payloadRef: "ref://1",
        requestClass: { unit: "call", units: "1" }, dataClass: 0,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { url, headers, correlationId: ((await created.json()) as { correlationId: string }).correlationId };
  }

  it("creates a pending escalation from an escalatable receipt, and lists it", async () => {
    const { url, headers } = await startWithEscalatedPurchase();
    const created = await fetch(`${url}/v1/escalations`, { method: "POST", headers, body: JSON.stringify({ receiptId: `0x${"aa".repeat(32)}` }) });
    expect(created.status).toBe(200);
    const { escalationId, proposal } = (await created.json()) as { escalationId: string; proposal: unknown };
    expect(proposal).toEqual(proposedAmendment);

    const listed = await fetch(`${url}/v1/escalations`, { headers });
    expect(await listed.json()).toMatchObject({ escalations: [{ escalationId, status: "PENDING" }] });
  });

  it("404s for a receiptId that was never issued", async () => {
    const { url, headers } = await startWithEscalatedPurchase();
    const response = await fetch(`${url}/v1/escalations`, { method: "POST", headers, body: JSON.stringify({ receiptId: `0x${"ff".repeat(32)}` }) });
    expect(response.status).toBe(404);
  });

  it("resolving an escalation removes it from the pending list", async () => {
    const { url, headers } = await startWithEscalatedPurchase();
    const created = await fetch(`${url}/v1/escalations`, { method: "POST", headers, body: JSON.stringify({ receiptId: `0x${"aa".repeat(32)}` }) });
    const { escalationId } = (await created.json()) as { escalationId: string };

    const resolved = await fetch(`${url}/v1/escalations/${escalationId}/resolve`, { method: "POST", headers, body: JSON.stringify({ status: "APPROVED" }) });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ escalationId, status: "APPROVED" });

    const listed = await fetch(`${url}/v1/escalations`, { headers });
    expect(await listed.json()).toEqual({ escalations: [] });
  });

  it("a rejected escalation (the Principal declining) also leaves the pending list, with REJECTED recorded", async () => {
    const { url, headers } = await startWithEscalatedPurchase();
    const created = await fetch(`${url}/v1/escalations`, { method: "POST", headers, body: JSON.stringify({ receiptId: `0x${"aa".repeat(32)}` }) });
    const { escalationId } = (await created.json()) as { escalationId: string };

    const resolved = await fetch(`${url}/v1/escalations/${escalationId}/resolve`, { method: "POST", headers, body: JSON.stringify({ status: "REJECTED" }) });
    expect(await resolved.json()).toMatchObject({ escalationId, status: "REJECTED" });
    expect(await (await fetch(`${url}/v1/escalations`, { headers })).json()).toEqual({ escalations: [] });
  });

  it("404s resolving an unknown escalation and 400s an invalid status", async () => {
    const { url, headers } = await startWithEscalatedPurchase();
    const missing = await fetch(`${url}/v1/escalations/${crypto.randomUUID()}/resolve`, { method: "POST", headers, body: JSON.stringify({ status: "APPROVED" }) });
    expect(missing.status).toBe(404);

    const created = await fetch(`${url}/v1/escalations`, { method: "POST", headers, body: JSON.stringify({ receiptId: `0x${"aa".repeat(32)}` }) });
    const { escalationId } = (await created.json()) as { escalationId: string };
    const badStatus = await fetch(`${url}/v1/escalations/${escalationId}/resolve`, { method: "POST", headers, body: JSON.stringify({ status: "MAYBE" }) });
    expect(badStatus.status).toBe(400);
  });
});
