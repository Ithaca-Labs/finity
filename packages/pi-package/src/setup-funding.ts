export const SETUP_FEE_RESERVE_TINYBAR = 200_000_000n;

/**
 * Derive the initial broker funding request from the public mandate draft.
 * The reserve covers Hedera transaction fees; the lifetime cap funds the
 * Spend Account without asking the Principal to calculate an amount.
 */
export function fundingAmountFromMandateDraft(draft: unknown): string | undefined {
  if (!draft || typeof draft !== "object") return undefined;
  const maxLifetime = (draft as { maxLifetime?: unknown }).maxLifetime;
  if (typeof maxLifetime !== "string" || !/^[1-9][0-9]*$/.test(maxLifetime)) return undefined;
  return (BigInt(maxLifetime) + SETUP_FEE_RESERVE_TINYBAR).toString();
}

export function validateFundingAmountTinybar(value: string): string {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("funding amount must be a positive integer number of tinybars");
  return value;
}
