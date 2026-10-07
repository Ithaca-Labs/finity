// Account mode (margin transfer) and builder-fee approval. Neither is ever on the path of a
// cancel or reduce-only close: if they fail, those recovery actions stay available.
import type { Hl } from "./client";

export type AbstractionMode = "unifiedAccount" | "portfolioMargin" | "disabled" | "default";

/** In default/disabled mode spot USDC is not perps collateral, so a usdClassTransfer is needed. */
export function needsClassTransfer(mode: AbstractionMode) {
  return mode === "default" || mode === "disabled";
}

export async function readAccountMode(hl: Hl, user: `0x${string}`): Promise<AbstractionMode> {
  return (await hl.info.userAbstraction({ user })) as AbstractionMode;
}

/** Proposed 0.05% builder fee: `f` is in tenths of a basis point. */
export const BUILDER_FEE = { f: 50, rate: "0.05%" } as const;

export type BuilderStatus =
  | { kind: "not_configured" }
  | { kind: "approved"; builder: `0x${string}`; maxF: number }
  | { kind: "not_approved"; builder: `0x${string}`; maxF: number }
  | { kind: "unreadable"; builder: `0x${string}`; error: string };

export async function builderStatus(hl: Hl, user: `0x${string}`, builder?: `0x${string}`): Promise<BuilderStatus> {
  if (!builder) return { kind: "not_configured" };
  try {
    const maxF = Number(await hl.info.maxBuilderFee({ user, builder }));
    return maxF >= BUILDER_FEE.f ? { kind: "approved", builder, maxF } : { kind: "not_approved", builder, maxF };
  } catch (e) {
    return { kind: "unreadable", builder, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ApproveResult = { ok: true } | { ok: false; limitReached: boolean; error: string };

/** Must be signed by the trading account's own key (HL rejects agent/API wallets for this action). */
export async function approveBuilder(hl: Hl, builder: `0x${string}`): Promise<ApproveResult> {
  if (!hl.exchange) throw new Error("No signer");
  try {
    await hl.exchange.approveBuilderFee({ builder, maxFeeRate: BUILDER_FEE.rate });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, limitReached: isBuilderLimitError(error), error };
  }
}

/** HL allows at most 10 active builder approvals per user. */
export function isBuilderLimitError(msg: string) {
  return /builder/i.test(msg) && /(max|limit|too many|10)/i.test(msg);
}

/** Attach the builder only when approved. Unapproved or failed setup means orders go without it, never blocked. */
export function builderForOrder(s: BuilderStatus) {
  return s.kind === "approved" ? { b: s.builder, f: BUILDER_FEE.f } : undefined;
}
