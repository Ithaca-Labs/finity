import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactHederaScheme, PrivateKey, createClientHederaSigner } from "@x402/hedera";
import { hashCanonicalJson, type Capability, type Quote } from "@finity/schemas";

export type PaymentRequirementsSubset = { scheme: string; network: string; amount: string; asset: string; payTo: string; extra?: { feePayer?: string } };
export class CommerceError extends Error {
  constructor(readonly code: "PAYMENT_TERMS_MISMATCH" | "PAYMENT_CHALLENGE_INVALID", message: string) { super(message); this.name = "CommerceError"; }
}

/** A 402 offer is acceptable only when it is the quote already authorized by policy. */
export function assertAuthorizedChallenge(challenge: unknown, quote: Quote): PaymentRequirementsSubset {
  const value = challenge as Partial<PaymentRequirementsSubset>;
  if (!value || value.scheme !== "exact" || value.network !== quote.network || value.amount !== quote.amount || value.asset !== quote.asset || value.payTo !== quote.payTo) {
    throw new CommerceError("PAYMENT_TERMS_MISMATCH", "402 payment requirements differ from the authorized quote");
  }
  if (!value.extra?.feePayer) throw new CommerceError("PAYMENT_CHALLENGE_INVALID", "402 challenge has no facilitator fee payer");
  return value as PaymentRequirementsSubset;
}

export type ChallengeParser = (response: Response) => Promise<PaymentRequirementsSubset[]>;

/**
 * Runs an unauthenticated probe, validates every offered requirement against the
 * quote, and only then creates the x402 payment retry. The private key stays in
 * the vault-worker call frame and is never part of the returned value.
 */
export async function paidFetch(input: {
  capability: Capability;
  quote: Quote;
  spendAccountId: string;
  brokerSessionKey: string;
  url: string;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
  parseChallenges: ChallengeParser;
}): Promise<Response> {
  if (Math.floor(Date.now() / 1000) >= input.capability.expiresAt) throw new CommerceError("PAYMENT_CHALLENGE_INVALID", "capability expired");
  if (input.capability.quoteHash !== hashCanonicalJson(input.quote)) throw new CommerceError("PAYMENT_CHALLENGE_INVALID", "capability is not bound to the authorized quote");
  const fetchImpl = input.fetchImpl ?? fetch;
  const initial = await fetchImpl(input.url, { ...input.init, redirect: "manual" });
  if (initial.status !== 402) return initial;
  const challenges = await input.parseChallenges(initial);
  if (challenges.length !== 1) throw new CommerceError("PAYMENT_CHALLENGE_INVALID", "expected exactly one payment requirement");
  assertAuthorizedChallenge(challenges[0], input.quote);
  const signer = createClientHederaSigner(input.spendAccountId, PrivateKey.fromString(input.brokerSessionKey), { network: input.quote.network });
  const client = new x402Client().register(input.quote.network, new ExactHederaScheme(signer));
  return wrapFetchWithPayment(fetchImpl, client)(input.url, { ...input.init, redirect: "manual" });
}
