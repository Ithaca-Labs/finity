import { expect, it } from "vitest";
import { makeEntry } from "./journal";
it("rejects secret-looking fields", () => {
  expect(() => makeEntry({ network: "testnet", kind: "x", account: "0x1", data: { privateKey: "0x" } })).toThrow();
  expect(makeEntry({ network: "testnet", kind: "order", account: "0x1", data: { cloid: "0xabc" } }).ts).toBeTruthy();
});
