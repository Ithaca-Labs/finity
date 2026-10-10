// Return leg: verified Unit withdrawal address, return planning (route minimum, fee, residual) and
// honest recovery options. Nothing here signs or sends: it only validates and plans.
import { verifyDepositAddressSignatures, type Network, type VerificationResult } from "./guardians";
import { UNIT_API, UNIT_ZEC_MIN_ZAT, type EvidenceSource, type ZcashFees } from "./unit";
import { parseZcashAddress } from "../zcash/address";

const ZAT = 100_000_000n;
export const fmtZec = (zat: bigint) => {
  const frac = (zat % ZAT).toString().padStart(8, "0").replace(/0+$/, "");
  return `${zat / ZAT}${frac ? "." + frac : ""}`;
};

export type DestinationCheck = { ok: true; address: string } | { ok: false; reason: string };

/**
 * Unit pays out to a transparent address. Shielded and unified addresses are refused here with an
 * explanation, and TEX is refused because no TEX withdrawal generation has been demonstrated.
 */
export function validateReturnDestination(network: Network, raw: string): DestinationCheck {
  let a;
  try { a = parseZcashAddress(raw); } catch (e) { return { ok: false, reason: `Not a valid Zcash address: ${e instanceof Error ? e.message : e}` }; }
  if (a.network !== network) return { ok: false, reason: `This is a ${a.network} address but the app is on ${network}.` };
  if (a.kind === "unified" || a.kind === "sapling") {
    return { ok: false, reason: "Unit pays out to a transparent address. Use your wallet's transparent (t1…) receive address; you then shield in your wallet." };
  }
  if (a.kind !== "p2pkh") return { ok: false, reason: `Address type ${a.kind} is not a demonstrated Unit withdrawal destination. Use a transparent t1… address.` };
  return { ok: true, address: a.raw };
}

export interface VerifiedWithdrawal {
  source: EvidenceSource;
  network: Network;
  destination: string;
  /** Unit-derived Hyperliquid address. The ONLY place the Unit token may be sent for this destination. */
  protocolAddress: `0x${string}`;
  verification: VerificationResult;
}

/**
 * Guardians sign `nodeId:user-ethereum-zcash-<zcash destination>-<protocol address>` (live mainnet,
 * 8 Oct 2026). `coinType` is "ethereum" because the protocol address is an HL/EVM address.
 */
export async function verifyWithdrawalResponse(
  network: Network, destination: string, ownHlAddress: string, res: { address?: unknown; signatures?: unknown }, source: EvidenceSource = "unit-live",
): Promise<VerifiedWithdrawal> {
  const dest = validateReturnDestination(network, destination);
  if (!dest.ok) throw new Error(dest.reason);
  if (typeof res.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(res.address) || typeof res.signatures !== "object" || !res.signatures) {
    throw new Error("Malformed Unit withdrawal response");
  }
  if (/^0x0{40}$/.test(res.address) || res.address.toLowerCase() === ownHlAddress.toLowerCase()) {
    throw new Error("Unit returned a protocol address that is zero or the user's own account");
  }
  const verification = await verifyDepositAddressSignatures(network, res.signatures as Record<string, string>, {
    destinationAddress: dest.address, destinationChain: "zcash", asset: "zec", address: res.address, sourceChain: "hyperliquid", coinType: "ethereum",
  });
  if (!verification.success) throw new Error(`Guardian verification failed (${verification.verifiedCount} of 3 valid, need 2)`);
  return { source, network, destination: dest.address, protocolAddress: res.address as `0x${string}`, verification };
}

/** Live generation + verification. On testnet Unit currently answers 400 for every Zcash destination. */
export async function generateWithdrawal(network: Network, destination: string, ownHlAddress: string): Promise<VerifiedWithdrawal> {
  const dest = validateReturnDestination(network, destination);
  if (!dest.ok) throw new Error(dest.reason);
  const r = await fetch(`${UNIT_API[network]}/gen/hyperliquid/zcash/zec/${dest.address}`, { cache: "no-store" });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`Unit ${r.status}: ${JSON.stringify(body)}${network === "testnet" ? " (Unit rejects its own protocol addresses as destinations; use a fresh address from your wallet)" : ""}`);
  }
  return verifyWithdrawalResponse(network, dest.address, ownHlAddress, body);
}

export type RecoveryStatus = "tested" | "implemented_untested" | "documented_only" | "untested" | "attempt_failed";
export interface RecoveryOption { id: string; title: string; description: string; status: RecoveryStatus }

/** Evidence for alternate routes lives here so UI and docs cannot claim more than was tested. */
export const RECOVERY_EVIDENCE: Record<string, RecoveryStatus> = {
  keep_in_account: "tested", // balances remain readable/controllable via recovery client (docs/TEST_EVIDENCE.md)
  sell_to_usdc: "implemented_untested", // needs liquidity; XZEC book empty on testnet
  usdc_bridge_withdraw: "attempt_failed", // HL testnet withdraw3 returned "Error withdrawing from bridge" at 5, 10 and 50 USDC (8 Oct 2026)
  wait_for_unit_minimum: "documented_only",
};

export function recoveryOptions(residualZat: bigint, evidence = RECOVERY_EVIDENCE): RecoveryOption[] {
  const r = fmtZec(residualZat);
  return [
    { id: "keep_in_account", title: "Keep it in the trading account", description: `${r} ZEC stays under your control. You can read it and act on it with the standalone recovery client at any time.`, status: evidence.keep_in_account },
    { id: "sell_to_usdc", title: "Sell to USDC", description: `Sell the ${r} ZEC token for USDC with a price-bounded order if the book has liquidity and the order is at least 10 USDC. The proceeds are user-controlled USDC; this does not return ZEC.`, status: evidence.sell_to_usdc },
    { id: "usdc_bridge_withdraw", title: "Withdraw USDC through Hyperliquid's bridge", description: "Withdraw the USDC proceeds to an EVM address. This leaves the Zcash route and is not a ZEC return.", status: evidence.usdc_bridge_withdraw },
    { id: "wait_for_unit_minimum", title: "Wait for a lower Unit minimum", description: "Unit documents that transfers below the minimum are reprocessed only if the minimum is later lowered. There is no promise it will be.", status: evidence.wait_for_unit_minimum },
  ];
}

export type ReturnPlan =
  | { ok: true; sendZat: bigint; feeZat: bigint; netZat: bigint; residualZat: bigint; warnings: string[] }
  | { ok: false; kind: "below_minimum" | "insufficient" | "fee_exceeds_amount" | "invalid"; reason: string; residualZat: bigint; recovery: RecoveryOption[] };

/**
 * Plan a return of `requestedZat` from a spot balance of `balanceZat`. The minimum applies to the amount
 * SENT to Unit. Anything the user cannot return is shown as an exact residual with its recovery options.
 */
export function planReturn(input: { balanceZat: bigint; requestedZat: bigint; fees: ZcashFees; minZat?: bigint }): ReturnPlan {
  const { balanceZat, requestedZat, fees } = input;
  const min = input.minZat ?? UNIT_ZEC_MIN_ZAT;
  const fail = (kind: Extract<ReturnPlan, { ok: false }>["kind"], reason: string, residualZat = balanceZat): ReturnPlan =>
    ({ ok: false, kind, reason, residualZat, recovery: residualZat > 0n ? recoveryOptions(residualZat) : [] });
  if (requestedZat <= 0n) return fail("invalid", "Amount must be positive");
  if (requestedZat > balanceZat) return fail("insufficient", `Requested ${fmtZec(requestedZat)} ZEC but only ${fmtZec(balanceZat)} ZEC is available.`);
  if (balanceZat < min) return fail("below_minimum", `Your balance of ${fmtZec(balanceZat)} ZEC is below Unit's ${fmtZec(min)} ZEC return minimum, so it cannot be returned as ZEC. Residual: ${fmtZec(balanceZat)} ZEC.`);
  if (requestedZat < min) return fail("below_minimum", `${fmtZec(requestedZat)} ZEC is below Unit's ${fmtZec(min)} ZEC minimum. Sending less than the minimum would strand the funds at Unit.`);
  if (fees.withdrawalFeeZat >= requestedZat) return fail("fee_exceeds_amount", "The Unit withdrawal fee is not smaller than the amount.");
  const residualZat = balanceZat - requestedZat;
  const warnings: string[] = [];
  if (residualZat > 0n && residualZat < min) warnings.push(`${fmtZec(residualZat)} ZEC would remain below the minimum and could not be returned later. Consider sending the whole balance.`);
  return { ok: true, sendZat: requestedZat, feeZat: fees.withdrawalFeeZat, netZat: requestedZat - fees.withdrawalFeeZat, residualZat, warnings };
}

/** Floors an HL decimal balance string to whole zatoshis (8 dp); never rounds up. */
export function balanceToZat(decimal: string): bigint {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(decimal);
  if (!m) throw new Error(`Bad balance ${decimal}`);
  return BigInt(m[1]) * ZAT + BigInt((m[2] ?? "").slice(0, 8).padEnd(8, "0"));
}
