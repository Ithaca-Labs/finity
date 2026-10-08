import { expect, it } from "vitest";
import { deriveReturn } from "../bridge/return-state";
import { RETURN_SCENARIOS, type ReturnScenario } from "./return-replay";

// Each fixture must produce exactly the state and shielding label its title claims, and none may
// reach "wallet_confirmed_shielded" without wallet evidence.
const EXPECT: Record<ReturnScenario, [string, string]> = {
  below_minimum: ["return_token_ready", "not_started"],
  token_ready: ["return_token_ready", "not_started"],
  send_unknown: ["outcome_unknown", "not_started"],
  in_queue: ["bridge_return_pending", "not_started"],
  delivered: ["delivered_transparent", "not_started"],
  marked: ["shielding_pending", "you_marked_shielded"],
  spent: ["shielding_pending", "transparent_output_spent"],
  wallet_confirmed: ["wallet_confirmed_shielded", "wallet_confirmed"],
  unit_failure: ["manual_recovery", "not_started"],
};

it("every replay scenario derives its labelled state", () => {
  for (const [k, def] of Object.entries(RETURN_SCENARIOS)) {
    const v = deriveReturn(def.evidence);
    expect([v.state, v.shielding], k).toEqual(EXPECT[k as ReturnScenario]);
    if (v.state === "wallet_confirmed_shielded") expect(def.evidence.walletEvidence).toBeDefined();
  }
});
