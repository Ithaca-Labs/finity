import { describe, expect, it } from "vitest";
import { verifyDepositAddressSignatures, type Proposal } from "./guardians";

// Live Unit testnet response captured 7 Oct 2026 (fixture, not a settlement trace).
const dest = "0x1f20B96A9fde5218ED05A212B2d23093100785c0";
const live = {
  address: "tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy",
  signatures: {
    "field-node": "6ax+LLsaw2lTwDfpFmPSQrXk7zExryl0eGAbKxAeGRi64wIHs7OFrSoEZUd/6KFiVYKcbg/+tG8pr/BwJV6C1Q==",
    "hl-node-testnet": "GlMY0pdMnD6SsdctMU1mgSpby+Wbb2oCE6teEL1uhoeZ5lbRp7qgstMIggQ8UOoBiXDk7w6UMVihN6qRJ8eMRg==",
    "node-1": "9aWN76MZ+NaO3tSejx85PDH92Zsk4a4mo071UDNIDZWueJu2xJPKoTxbsU0PyJIym3XmACfIiisb6WyUWX1w3g==",
  },
};
const proposal: Proposal = { destinationAddress: dest, destinationChain: "hyperliquid", asset: "zec", address: live.address, sourceChain: "zcash", coinType: "zcash" };

describe("guardian verification", () => {
  it("accepts the live testnet response with all 3 signatures", async () => {
    const r = await verifyDepositAddressSignatures("testnet", live.signatures, proposal);
    expect(r.success).toBe(true);
    expect(r.verifiedCount).toBe(3);
  });
  it("accepts exactly 2 valid signatures", async () => {
    const { "node-1": _, ...two } = live.signatures;
    expect((await verifyDepositAddressSignatures("testnet", two, proposal)).success).toBe(true);
  });
  it("rejects fewer than 2 signatures", async () => {
    const one = { "field-node": live.signatures["field-node"] };
    expect((await verifyDepositAddressSignatures("testnet", one, proposal)).success).toBe(false);
  });
  it("rejects the other network's keys", async () => {
    expect((await verifyDepositAddressSignatures("mainnet", live.signatures, proposal)).success).toBe(false);
  });
  it("rejects a tampered deposit address", async () => {
    const r = await verifyDepositAddressSignatures("testnet", live.signatures, { ...proposal, address: "tmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" });
    expect(r.success).toBe(false);
  });
  it("rejects a tampered destination", async () => {
    const r = await verifyDepositAddressSignatures("testnet", live.signatures, { ...proposal, destinationAddress: "0x0000000000000000000000000000000000000001" });
    expect(r.success).toBe(false);
  });
  it("rejects a corrupted signature", async () => {
    const bad = { ...live.signatures, "node-1": live.signatures["field-node"], "field-node": live.signatures["node-1"] };
    expect((await verifyDepositAddressSignatures("testnet", bad, proposal)).verifiedCount).toBeLessThan(3);
  });
});
