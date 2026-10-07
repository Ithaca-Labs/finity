// DEVELOPMENT-ONLY replay of Unit responses. Every value it produces is labelled source: "replay".
// The deposit address response is a real captured testnet response (so verification is real);
// the operations are synthetic, because no real testnet deposit has settled yet.
import type { Network } from "../bridge/guardians";
import { parseFees, verifyDepositResponse, type BridgeAdapter, type UnitOperation } from "../bridge/unit";

export const REPLAY_SCENARIOS = ["awaiting", "happy", "below_minimum", "failure", "provider_error", "flaky"] as const;
export type ReplayScenario = (typeof REPLAY_SCENARIOS)[number];

// Captured 7 Oct 2026 from api.hyperunit-testnet.xyz for 0x1f20…85c0.
const CAPTURED_HL = "0x1f20B96A9fde5218ED05A212B2d23093100785c0";
const CAPTURED_GEN = {
  address: "tmJGd4YHjcwSQpfU4qubWpWcxU4tWqDkyjy",
  signatures: {
    "field-node": "6ax+LLsaw2lTwDfpFmPSQrXk7zExryl0eGAbKxAeGRi64wIHs7OFrSoEZUd/6KFiVYKcbg/+tG8pr/BwJV6C1Q==",
    "hl-node-testnet": "GlMY0pdMnD6SsdctMU1mgSpby+Wbb2oCE6teEL1uhoeZ5lbRp7qgstMIggQ8UOoBiXDk7w6UMVihN6qRJ8eMRg==",
    "node-1": "9aWN76MZ+NaO3tSejx85PDH92Zsk4a4mo071UDNIDZWueJu2xJPKoTxbsU0PyJIym3XmACfIiisb6WyUWX1w3g==",
  },
};
const CAPTURED_FEES = { zcash: { "deposit-fee-in-units": 0.00581428, depositEta: "126m", depositFee: 581428, "withdrawal-fee-in-units": 0.00015, withdrawalEta: "5m", withdrawalFee: 15000 } };

/** Replay timeline, compressed: 1 replay second stands for 1 real minute of the ~125 min wait. */
const HAPPY: { atSec: number; state: string; confs?: number }[] = [
  { atSec: 5, state: "sourceTxDiscovered", confs: 0 },
  { atSec: 10, state: "waitForSrcTxFinalization", confs: 1 },
  { atSec: 60, state: "waitForSrcTxFinalization", confs: 48 },
  { atSec: 125, state: "buildingDstTx", confs: 100 },
  { atSec: 130, state: "waitForDstTxFinalization", confs: 100 },
  { atSec: 135, state: "done", confs: 100 },
];

export class ReplayBridgeAdapter implements BridgeAdapter {
  readonly source = "replay" as const;
  private polls = 0;
  constructor(readonly network: Network, readonly scenario: ReplayScenario, private readonly startedAt = Date.now(), private readonly now = () => Date.now()) {
    if (network !== "testnet") throw new Error("Replay adapter is testnet-only and cannot be used on mainnet");
  }

  async generateDeposit(hlAddress: `0x${string}`) {
    if (hlAddress.toLowerCase() !== CAPTURED_HL.toLowerCase()) {
      throw new Error(`Replay only has a captured, signed address for ${CAPTURED_HL}. Use the live Unit lane for other accounts.`);
    }
    return verifyDepositResponse(this.network, hlAddress, CAPTURED_GEN, "replay");
  }

  async fees() {
    return parseFees(CAPTURED_FEES, "replay");
  }

  async operations(hlAddress: `0x${string}`) {
    this.polls++;
    if (this.scenario === "provider_error" || (this.scenario === "flaky" && this.polls % 2 === 0)) throw new Error("Replay: simulated Unit 503");
    const elapsed = (this.now() - this.startedAt) / 1000;
    const op = (state: string, extra: Partial<UnitOperation> = {}): UnitOperation => ({
      operationId: "replay-op-1", protocolAddress: CAPTURED_GEN.address, sourceChain: "zcash", destinationChain: "hyperliquid",
      destinationAddress: hlAddress, sourceAmount: "10000000", state, sourceTxHash: "replay-txid-0000:0", opCreatedAt: new Date(this.startedAt).toISOString(), ...extra,
    });
    const addresses = [{ address: "textest1thdh90ttywp4tjf9ljc7q5u8sa564ggp9jt7yf", sourceCoinType: "zcash" }];
    if (this.scenario === "awaiting" || elapsed < 5) return { operations: [], addresses };
    if (this.scenario === "below_minimum") return { operations: [op("failure", { sourceAmount: "5000000", error: "amount below minimum" })], addresses };
    if (this.scenario === "failure") return { operations: [op("failure", { error: "replay: simulated failure" })], addresses };
    const step = [...HAPPY].reverse().find((s) => elapsed >= s.atSec)!;
    return { operations: [op(step.state, { sourceTxConfirmations: step.confs, ...(step.state === "done" ? { destinationTxHash: "replay-hl-tx" } : {}) })], addresses };
  }
}
