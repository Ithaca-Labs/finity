import type { MandateChoices } from "@therick/mandate-compiler";

/**
 * Return registration choices for a new mandate.
 *
 * MandateRegistry consumes a principal's nonce permanently. Draft files are
 * policy templates, so a retry must not replay their old registration nonce.
 */
export function withFreshMandateNonce(choices: MandateChoices, nowMs = Date.now()): MandateChoices {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("mandate nonce timestamp must be a non-negative safe integer");
  return { ...choices, nonce: String(nowMs) };
}
