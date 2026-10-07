// UnitBridgeAdapter: deposit address generation bound to guardian signatures, live fees,
// minimum enforcement, and raw operation reads. Never invents an address; never retries a send.
import { verifyDepositAddressSignatures, type Network, type VerificationResult } from "./guardians";
import { parseZcashAddress, sameTransparentKey, texToP2pkh, zecToZatoshis, type ZcashAddress } from "../zcash/address";

export const UNIT_API: Record<Network, string> = {
  mainnet: "https://api.hyperunit.xyz",
  testnet: "https://api.hyperunit-testnet.xyz",
};

/** Unit documented minimum (docs.hyperunit.xyz generate-address). Deposits below it get stuck. */
export const UNIT_ZEC_MIN_ZAT = zecToZatoshis("0.07");
/** PRD pilot cap per dedicated account. */
export const PILOT_CAP_ZAT = zecToZatoshis("2");

export type EvidenceSource = "unit-live" | "replay";

export interface VerifiedDeposit {
  source: EvidenceSource;
  network: Network;
  hlAddress: `0x${string}`;
  /** Exactly what Unit returned; this is what the user pays. Never rewritten. */
  payAddress: string;
  payKind: ZcashAddress["kind"];
  verification: VerificationResult;
}

export interface ZcashFees {
  source: EvidenceSource;
  depositFeeZat: bigint;
  depositEta: string;
  withdrawalFeeZat: bigint;
  withdrawalEta: string;
  fetchedAt: string;
}

/** Raw Unit operation, kept whole so later reconciliation can re-read every field. */
export interface UnitOperation {
  operationId: string;
  protocolAddress: string;
  sourceChain: string;
  destinationChain: string;
  destinationAddress: string;
  sourceAmount?: string;
  destinationFeeAmount?: string;
  sweepFeeAmount?: string;
  state: string;
  sourceTxHash?: string;
  destinationTxHash?: string;
  sourceTxConfirmations?: number;
  opCreatedAt?: string;
  stateUpdatedAt?: string;
  [k: string]: unknown;
}

export interface BridgeAdapter {
  readonly source: EvidenceSource;
  readonly network: Network;
  generateDeposit(hlAddress: `0x${string}`): Promise<VerifiedDeposit>;
  fees(): Promise<ZcashFees>;
  operations(hlAddress: `0x${string}`): Promise<{ operations: UnitOperation[]; addresses: { address: string; sourceCoinType?: string }[] }>;
}

/**
 * Verify a Unit deposit response. Guardians sign the transparent P2PKH form; a TEX response
 * is checked through its P2PKH equivalent, and the user still pays the TEX string.
 */
export async function verifyDepositResponse(
  network: Network, hlAddress: `0x${string}`, res: { address?: unknown; signatures?: unknown }, source: EvidenceSource = "unit-live",
): Promise<VerifiedDeposit> {
  if (typeof res.address !== "string" || typeof res.signatures !== "object" || !res.signatures) throw new Error("Malformed Unit response");
  const parsed = parseZcashAddress(res.address);
  if (parsed.network !== network) throw new Error(`Unit returned a ${parsed.network} address on ${network}`);
  if (parsed.kind !== "p2pkh" && parsed.kind !== "tex") throw new Error(`Unexpected deposit address type ${parsed.kind}`);
  const signedForm = parsed.kind === "tex" ? texToP2pkh(parsed) : parsed.raw;
  const verification = await verifyDepositAddressSignatures(network, res.signatures as Record<string, string>, {
    destinationAddress: hlAddress, destinationChain: "hyperliquid", asset: "zec", address: signedForm, sourceChain: "zcash", coinType: "zcash",
  });
  if (!verification.success) throw new Error(`Guardian verification failed (${verification.verifiedCount} of 3 valid, need 2)`);
  return { source, network, hlAddress, payAddress: parsed.raw, payKind: parsed.kind, verification };
}

/** Unit lists the same mapping on /operations, sometimes in a different encoding. It must be the same key. */
export function crossCheckMapping(dep: VerifiedDeposit, listed: { address: string; sourceCoinType?: string }[]) {
  const mine = parseZcashAddress(dep.payAddress);
  const zec = listed.filter((a) => a.sourceCoinType === "zcash");
  if (zec.length === 0) return { ok: true as const, note: "No mapping listed on /operations yet" };
  const match = zec.find((a) => { try { return sameTransparentKey(mine, parseZcashAddress(a.address)); } catch { return false; } });
  return match ? { ok: true as const, note: `Matches ${match.address}` } : { ok: false as const, note: "Listed mapping differs from verified address" };
}

const ZAT_PER_ZEC = 100_000_000;
const toZat = (units: unknown) => {
  if (typeof units !== "number" || !Number.isFinite(units)) throw new Error("Malformed fee");
  return BigInt(Math.round(units * ZAT_PER_ZEC));
};

export function parseFees(body: any, source: EvidenceSource = "unit-live"): ZcashFees {
  const z = body?.zcash;
  if (!z) throw new Error("Unit fee response has no zcash entry");
  return {
    source,
    depositFeeZat: typeof z.depositFee === "number" ? BigInt(z.depositFee) : toZat(z["deposit-fee-in-units"]),
    depositEta: String(z.depositEta ?? "unknown"),
    withdrawalFeeZat: typeof z.withdrawalFee === "number" ? BigInt(z.withdrawalFee) : toZat(z["withdrawal-fee-in-units"]),
    withdrawalEta: String(z.withdrawalEta ?? "unknown"),
    fetchedAt: new Date().toISOString(),
  };
}

export type FundingCheck =
  | { ok: true; amountZat: bigint; estNetZat: bigint }
  | { ok: false; reason: string };

/** Blocks the QR for sub-minimum or over-cap amounts. Minimum is applied after the inbound fee. */
export function checkFundingAmount(amountZat: bigint, fees: ZcashFees, capZat = PILOT_CAP_ZAT): FundingCheck {
  const floor = UNIT_ZEC_MIN_ZAT + fees.depositFeeZat;
  if (amountZat < floor) return { ok: false, reason: `Below the 0.07 ZEC Unit minimum plus the current inbound fee. Deposits below the minimum get stuck. Send at least ${Number(floor) / ZAT_PER_ZEC} ZEC.` };
  if (amountZat > capZat) return { ok: false, reason: `Above the pilot cap of ${Number(capZat) / ZAT_PER_ZEC} ZEC per account.` };
  return { ok: true, amountZat, estNetZat: amountZat - fees.depositFeeZat };
}

async function getJson(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Unit ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

export class UnitBridgeAdapter implements BridgeAdapter {
  readonly source = "unit-live" as const;
  constructor(readonly network: Network) {}
  async generateDeposit(hlAddress: `0x${string}`) {
    return verifyDepositResponse(this.network, hlAddress, await getJson(`${UNIT_API[this.network]}/gen/zcash/hyperliquid/zec/${hlAddress}`));
  }
  async fees() {
    return parseFees(await getJson(`${UNIT_API[this.network]}/v2/estimate-fees`));
  }
  async operations(hlAddress: `0x${string}`) {
    const body = await getJson(`${UNIT_API[this.network]}/operations/${hlAddress}`);
    return { operations: (body.operations ?? []) as UnitOperation[], addresses: body.addresses ?? [] };
  }
}
