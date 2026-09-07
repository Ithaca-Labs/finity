import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FinitydClient, FinitydError, loadFinitydRuntimeInfo } from "./finityd-client.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("loadFinitydRuntimeInfo", () => {
  it("reads a valid runtime info file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finity-runtime-"));
    const path = join(dir, "finityd.runtime.json");
    try {
      writeFileSync(path, JSON.stringify({ baseUrl: "http://127.0.0.1:4000", token: "tok" }));
      expect(await loadFinitydRuntimeInfo(path)).toEqual({ baseUrl: "http://127.0.0.1:4000", token: "tok" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed with a clear error when finityd has not written the file", async () => {
    await expect(loadFinitydRuntimeInfo("/nonexistent/finityd.runtime.json")).rejects.toThrow(FinitydError);
  });

  it("fails closed on a malformed runtime info file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finity-runtime-"));
    const path = join(dir, "finityd.runtime.json");
    try {
      writeFileSync(path, JSON.stringify({ baseUrl: 123 }));
      await expect(loadFinitydRuntimeInfo(path)).rejects.toThrow(FinitydError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("FinitydClient", () => {
  it("sends the bearer token and parses a successful response", async () => {
    let seenAuth: string | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenAuth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as typeof fetch;
    const client = new FinitydClient({ baseUrl: "http://127.0.0.1:4000", token: "tok", fetchImpl });
    expect(await client.health()).toEqual({ status: "ok" });
    expect(seenAuth).toBe("Bearer tok");
  });

  it("throws FinitydError with the server's error message on a non-OK response", async () => {
    const client = new FinitydClient({ baseUrl: "http://127.0.0.1:4000", token: "tok", fetchImpl: fakeFetch(404, { error: "not_found" }) });
    await expect(client.getIntent("abc")).rejects.toMatchObject({ status: 404, message: "not_found" });
  });

  it("posts a JSON body for createIntent", async () => {
    let seenBody = "";
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ correlationId: "c1", status: "INTENT" }), { status: 202 });
    }) as typeof fetch;
    const client = new FinitydClient({ baseUrl: "http://127.0.0.1:4000", token: "tok", fetchImpl });
    const result = await client.createIntent({
      mandateId: `0x${"01".repeat(32)}`, agentUaid: "did:aid:buyer", requestClass: { unit: "call", units: "1" },
      payloadRef: "ref://1", dataClass: 0,
    });
    expect(result).toEqual({ correlationId: "c1", status: "INTENT" });
    expect(JSON.parse(seenBody)).toMatchObject({ agentUaid: "did:aid:buyer" });
  });
});
