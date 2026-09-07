import { describe, expect, it } from "vitest";
import { REASON_CODES } from "@finity/policy-engine";
import { explainRefusal, pollPurchase } from "./buyer-tools.js";

describe("pollPurchase", () => {
  it("stops as soon as the purchase reaches a terminal state", async () => {
    const states = ["INTENT", "DISCOVERED", "QUOTED", "RECONCILED"];
    let calls = 0;
    const getIntent = async () => ({ state: states[Math.min(calls++, states.length - 1)] });
    const sleeps: number[] = [];
    const result = await pollPurchase(getIntent, "c1", { sleep: async (ms) => { sleeps.push(ms); } });
    expect(result).toEqual({ state: "RECONCILED" });
    expect(calls).toBe(4);
    expect(sleeps).toHaveLength(3);
  });

  it("returns the last observed state once the timeout elapses, without throwing", async () => {
    let now = 0;
    const getIntent = async () => ({ state: "QUOTED" });
    const result = await pollPurchase(getIntent, "c1", {
      timeoutMs: 10,
      now: () => now,
      sleep: async () => { now += 20; },
    });
    expect(result).toEqual({ state: "QUOTED" });
  });
});

describe("explainRefusal", () => {
  it("explains every known reason code without falling back to 'unrecognized'", () => {
    for (const code of REASON_CODES) {
      const explanation = explainRefusal({ decision: "REFUSED", reasonCodes: [code] });
      expect(explanation).not.toContain("unrecognized reason code");
      expect(explanation.toLowerCase()).toContain("refused");
    }
  });

  it("frames an escalation differently from a terminal refusal", () => {
    const escalation = explainRefusal({ decision: "ESCALATION_REQUIRED", reasonCodes: ["PRICE_LIMIT_EXCEEDED"], proposedAmendment: {} });
    expect(escalation).toContain("requires escalation");
    expect(escalation).toContain("approve a one-time increase");

    const refusal = explainRefusal({ decision: "REFUSED", reasonCodes: ["SERVICE_NOT_ALLOWED"] });
    expect(refusal).toContain("was refused");
    expect(refusal).toContain("final unless");
  });

  it("reports when there is nothing to explain", () => {
    expect(explainRefusal(undefined)).toContain("No refusal or escalation information");
    expect(explainRefusal({ reasonCodes: [] })).toContain("No refusal or escalation information");
  });
});
