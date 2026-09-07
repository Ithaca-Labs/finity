import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadActiveMandate, saveActiveMandate } from "./active-mandate.js";

describe("active mandate persistence", () => {
  it("round-trips through save/load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finity-active-mandate-"));
    const path = join(dir, "active-mandate.json");
    try {
      const mandate = { mandateId: `0x${"01".repeat(32)}`, agentUaid: "did:aid:buyer", brokerUaid: "did:aid:broker" };
      await saveActiveMandate(path, mandate);
      expect(await loadActiveMandate(path)).toEqual(mandate);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined when no mandate has been set", async () => {
    expect(await loadActiveMandate("/nonexistent/active-mandate.json")).toBeUndefined();
  });

  it("returns undefined for a malformed file rather than throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finity-active-mandate-"));
    const path = join(dir, "active-mandate.json");
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, JSON.stringify({ mandateId: 123 }));
      expect(await loadActiveMandate(path)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
