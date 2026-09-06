import { describe, expect, it } from "vitest";
import { canonicalizeJson, hashCanonicalJson } from "./canonical.js";
import { IllegalTransition, reduceCapability, reduceMandate, reducePurchase } from "./state.js";

describe("canonical JSON", () => {
  it("is independent of object key insertion order", () => {
    const left = { z: 3, nested: { b: true, a: "x" }, a: [2, 1] };
    const right = { a: [2, 1], nested: { a: "x", b: true }, z: 3 };
    expect(canonicalizeJson(left)).toBe(canonicalizeJson(right));
    expect(hashCanonicalJson(left)).toBe(hashCanonicalJson(right));
  });
});

describe("state reducers", () => {
  it("accepts the mandate happy path and terminal transitions", () => {
    expect(reduceMandate("DRAFT", { type: "SIGNED" })).toBe("SIGNED");
    expect(reduceMandate("SIGNED", { type: "ACTIVATED" })).toBe("ACTIVE");
    expect(reduceMandate("ACTIVE", { type: "REVOKED" })).toBe("REVOKED");
  });

  it("rejects illegal and terminal transitions", () => {
    expect(() => reduceMandate("DRAFT", { type: "ACTIVATED" })).toThrow(IllegalTransition);
    expect(() => reduceMandate("REVOKED", { type: "ACTIVATED" })).toThrow(IllegalTransition);
    expect(() => reducePurchase("RECONCILED", { type: "PAID" })).toThrow(IllegalTransition);
    expect(() => reduceCapability("CONSUMED", { type: "LEASED" })).toThrow(IllegalTransition);
  });

  it("drives purchase and capability flows", () => {
    let purchase = reducePurchase("INTENT", { type: "DISCOVERED" });
    purchase = reducePurchase(purchase, { type: "QUOTED" });
    purchase = reducePurchase(purchase, { type: "EVALUATING" });
    purchase = reducePurchase(purchase, { type: "AUTHORIZED" });
    purchase = reducePurchase(purchase, { type: "RESERVED" });
    purchase = reducePurchase(purchase, { type: "PAID" });
    purchase = reducePurchase(purchase, { type: "DELIVERED" });
    expect(reducePurchase(purchase, { type: "RECONCILED" })).toBe("RECONCILED");
    expect(reduceCapability("ISSUED", { type: "LEASED" })).toBe("LEASED");
    expect(reduceCapability("LEASED", { type: "CONSUMED" })).toBe("CONSUMED");
  });
});

