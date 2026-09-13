import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { setupFundingAmount } from "./extensions/finity.js";

function context(input: ReturnType<typeof vi.fn>): ExtensionCommandContext {
  return { ui: { input } } as unknown as ExtensionCommandContext;
}

describe("interactive setup funding prompt", () => {
  it("asks for an amount even when a mandate draft can suggest one", async () => {
    const home = await mkdtemp(join(tmpdir(), "finity-setup-prompt-"));
    try {
      await writeFile(join(home, "mandate-draft.json"), JSON.stringify({ maxLifetime: "2000000000" }));
      const input = vi.fn().mockResolvedValue("3");

      await expect(setupFundingAmount(home, context(input))).resolves.toBe("300000000");
      expect(input).toHaveBeenCalledWith(
        "Initial broker funding",
        expect.stringContaining("mandate draft suggests at least 22 HBAR"),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("asks for an amount without requiring a mandate draft", async () => {
    const home = await mkdtemp(join(tmpdir(), "finity-setup-prompt-"));
    try {
      const input = vi.fn().mockResolvedValue("1.5");

      await expect(setupFundingAmount(home, context(input))).resolves.toBe("150000000");
      expect(input).toHaveBeenCalledWith(
        "Initial broker funding",
        expect.stringContaining("How much HBAR should your Ledger send"),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
