import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOnboardingState, saveOnboardingState } from "./onboarding-state.js";

describe("onboarding state", () => {
  it("persists only public resumable metadata", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "finity-onboarding-")), "onboarding.json");
    await saveOnboardingState(path, {
      version: 1, stage: "FUNDED", brokerAddress: `0x${"11".repeat(20)}`,
      principalAddress: `0x${"22".repeat(20)}`, fundingTxHash: `0x${"33".repeat(32)}`,
    });
    expect(await loadOnboardingState(path)).toMatchObject({ stage: "FUNDED" });
    const raw = await readFile(path, "utf8");
    expect(raw).not.toMatch(/private|sessionKey|password|WALLET_PASS/i);
  });

  it("fails closed on malformed state", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "finity-onboarding-")), "onboarding.json");
    await expect(saveOnboardingState(path, {
      version: 1, stage: "FUNDED", brokerAddress: "not-an-address",
    } as never)).rejects.toThrow();
  });
});
