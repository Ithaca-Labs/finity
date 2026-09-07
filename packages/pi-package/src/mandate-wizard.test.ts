import { describe, expect, it } from "vitest";
import type { CompiledMandate } from "@finity/mandate-compiler";
import { registerMandateOnChain, type TraceTopicCreator } from "./mandate-wizard.js";

const choices = {
  agent: "did:aid:buyer",
  broker: "0x1111111111111111111111111111111111111111",
  spendAccount: "0.0.123",
  allowedServices: "hello-weather@1",
  allowedMethods: "weather.current",
  asset: "HBAR" as const,
  maxPerRequest: "5000000",
  maxPerPeriod: "500000000",
  periodSeconds: "86400",
  maxLifetime: "2000000000",
  maxUnitsPerRequest: "0",
  validFrom: 1_788_739_200,
  validUntil: 1_790_208_000,
  quoteMaxAgeSeconds: "120",
  dataClass: 0,
  escalationRule: "anything above per-request cap needs my Ledger",
  policyHash: `0x${"aa".repeat(32)}`,
  nonce: "1",
  predecessor: `0x${"00".repeat(32)}`,
  verifyingContract: "0x2222222222222222222222222222222222222222",
};

const FAKE_SIGNATURE = `0x${"11".repeat(65)}` as `0x${string}`;
const FAKE_REGISTRATION_TX = `0x${"22".repeat(32)}` as `0x${string}`;
const FAKE_SET_TRACE_TX = `0x${"33".repeat(32)}` as `0x${string}`;

describe("registerMandateOnChain", () => {
  it("signs exactly what compile() produced, then registers and binds a trace topic in order", async () => {
    const calls: string[] = [];
    let seenTypedData: CompiledMandate["typedData"] | undefined;
    const result = await registerMandateOnChain({
      choices,
      sign: async (typedData) => {
        calls.push("sign");
        seenTypedData = typedData;
        return FAKE_SIGNATURE;
      },
      registryClient: {
        registerMandate: async () => {
          calls.push("registerMandate");
          return FAKE_REGISTRATION_TX;
        },
        setTraceTopic: async () => {
          calls.push("setTraceTopic");
          return FAKE_SET_TRACE_TX;
        },
      },
      createTraceTopic: (async (memo) => {
        calls.push("createTraceTopic");
        expect(memo).toContain("Finity mandate trace");
        return { topicId: "0.0.999", transactionId: "0.0.5@1.0" };
      }) satisfies TraceTopicCreator,
    });

    expect(calls).toEqual(["sign", "registerMandate", "createTraceTopic", "setTraceTopic"]);
    expect(seenTypedData?.primaryType).toBe("AgentMandate");
    expect(seenTypedData?.message.agent).toBe("did:aid:buyer");
    expect(result).toMatchObject({
      registrationTx: FAKE_REGISTRATION_TX,
      traceTopicId: "0.0.999",
      traceTopicTx: "0.0.5@1.0",
      setTraceTopicTx: FAKE_SET_TRACE_TX,
    });
    expect(result.mandateId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("never registers on-chain when the device signature is declined", async () => {
    let registerCalled = false;
    await expect(
      registerMandateOnChain({
        choices,
        sign: async () => {
          throw new Error("Rejected on device");
        },
        registryClient: {
          registerMandate: async () => {
            registerCalled = true;
            return FAKE_REGISTRATION_TX;
          },
          setTraceTopic: async () => FAKE_SET_TRACE_TX,
        },
        createTraceTopic: async () => ({ topicId: "0.0.999", transactionId: "tx" }),
      }),
    ).rejects.toThrow("Rejected on device");
    expect(registerCalled).toBe(false);
  });

  it("never creates a trace topic when on-chain registration fails", async () => {
    let topicCreated = false;
    await expect(
      registerMandateOnChain({
        choices,
        sign: async () => FAKE_SIGNATURE,
        registryClient: {
          registerMandate: async () => {
            throw new Error("reverted: NonceAlreadyUsed");
          },
          setTraceTopic: async () => FAKE_SET_TRACE_TX,
        },
        createTraceTopic: async () => {
          topicCreated = true;
          return { topicId: "0.0.999", transactionId: "tx" };
        },
      }),
    ).rejects.toThrow("NonceAlreadyUsed");
    expect(topicCreated).toBe(false);
  });
});
