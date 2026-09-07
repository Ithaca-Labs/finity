import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateIdentity, loadIdentityFile, saveIdentityFile } from "./identity.js";

describe("generateIdentity", () => {
  it("is deterministic for the same stable fields", async () => {
    const a = await generateIdentity({ name: "finity-buyer", nativeId: "hedera:testnet:0.0.123", uid: "buyer-1" });
    const b = await generateIdentity({ name: "finity-buyer", nativeId: "hedera:testnet:0.0.123", uid: "buyer-1" });
    expect(a.uaid).toBe(b.uaid);
    expect(a.uaid).toMatch(/^uaid:aid:/);
  });

  it("changes when a stable field changes", async () => {
    const a = await generateIdentity({ name: "finity-buyer", nativeId: "hedera:testnet:0.0.123" });
    const b = await generateIdentity({ name: "finity-buyer", nativeId: "hedera:testnet:0.0.456" });
    expect(a.uaid).not.toBe(b.uaid);
  });

  it("defaults registry, version, protocol, and skills", async () => {
    const identity = await generateIdentity({ name: "finity-broker", nativeId: "hedera:testnet:0.0.789" });
    expect(identity.canonical).toMatchObject({ registry: "finity", version: "1", protocol: "finity/1", skills: [] });
  });
});

describe("identity file persistence", () => {
  it("round-trips through save/load and returns undefined when absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finity-identity-"));
    const path = join(dir, "identity.json");
    try {
      expect(await loadIdentityFile(path)).toBeUndefined();
      const agent = await generateIdentity({ name: "finity-buyer", nativeId: "hedera:testnet:0.0.123" });
      await saveIdentityFile(path, { agent });
      expect(await loadIdentityFile(path)).toEqual({ agent });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
