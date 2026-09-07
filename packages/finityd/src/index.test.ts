import { describe, expect, it, afterEach } from "vitest";
import { startFinityd, type Finityd } from "./index.js";

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
    expect(await response.json()).toEqual({ status: "ok" });
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
