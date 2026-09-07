import type { ReasonCode } from "@finity/policy-engine";

const TERMINAL_STATES = new Set([
  "RECONCILED", "REFUSED", "ESCALATION_REQUIRED",
  "FAILED_DISCOVERY", "FAILED_QUOTE", "FAILED_EVALUATION", "FAILED_RESERVATION", "FAILED_PAYMENT", "FAILED_DELIVERY", "FAILED_RECONCILIATION",
]);

export type GetIntent = (correlationId: string) => Promise<Record<string, unknown>>;
export type PollPurchaseOptions = { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number };

/**
 * finity_purchase polls GET /v1/intents until the purchase reaches a
 * terminal state (or the timeout elapses, in which case the last observed
 * non-terminal state is returned rather than throwing - the purchase is
 * still in flight, not failed).
 */
export async function pollPurchase(getIntent: GetIntent, correlationId: string, options: PollPurchaseOptions = {}): Promise<Record<string, unknown>> {
  const intervalMs = options.intervalMs ?? 300;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  for (;;) {
    const purchase = await getIntent(correlationId);
    if (typeof purchase.state === "string" && TERMINAL_STATES.has(purchase.state)) return purchase;
    if (now() >= deadline) return purchase;
    await sleep(intervalMs);
  }
}

const REASON_EXPLANATIONS: Record<ReasonCode, string> = {
  MANDATE_INACTIVE: "the mandate authorizing this agent is not currently active",
  MANDATE_EXPIRED: "the mandate has expired",
  MANDATE_SUPERSEDED: "the mandate has been superseded by a newer amendment",
  SIGNATURE_INVALID: "the mandate's signature could not be verified",
  DISPLAY_MISMATCH: "the mandate's on-chain display text does not match its numeric limits",
  AGENT_MISMATCH: "this agent is not the one named in the mandate",
  BROKER_NOT_AUTHORIZED: "this broker is not the one named in the mandate",
  PROVIDER_NOT_ALLOWED: "this provider's Hedera account is not allowed",
  SERVICE_NOT_ALLOWED: "this service is not on the mandate's allowed list",
  METHOD_NOT_ALLOWED: "this method is not on the mandate's allowed list",
  ASSET_NOT_ALLOWED: "the quoted asset does not match the mandate's allowed asset",
  QUOTE_INVALID: "the provider's quote failed validation",
  QUOTE_EXPIRED: "the provider's quote expired before it could be used",
  PAYMENT_TERMS_MISMATCH: "the payment terms did not match the authorized quote",
  PRICE_LIMIT_EXCEEDED: "this request costs more than the mandate's per-request cap",
  UNIT_LIMIT_EXCEEDED: "this request asks for more units than the mandate allows per request",
  PERIOD_BUDGET_EXCEEDED: "this request would exceed the mandate's period budget",
  LIFETIME_BUDGET_EXCEEDED: "this request would exceed the mandate's lifetime budget",
  DATA_POLICY_VIOLATION: "this request's data sensitivity exceeds what the mandate allows",
  POLICY_VERSION_MISMATCH: "the mandate was signed against a different policy version than the broker is running",
  REVOCATION_ACTIVE: "the mandate has been revoked",
  CAPABILITY_REPLAY: "this capability has already been used once",
  STATE_UNAVAILABLE: "the broker could not assemble enough state to evaluate this request",
};

export type Refusal = { decision?: string; reasonCodes?: unknown; proposedAmendment?: unknown };

/**
 * finity_explain_refusal: turns a purchase's refusal/escalation reason codes
 * into plain language the model can relay, per user story 18. Never asks the
 * user to reformulate around anything the mandate itself forbids - that
 * judgment is the finity-buyer skill's job, not this function's.
 */
export function explainRefusal(refusal: Refusal | undefined): string {
  if (!refusal || !Array.isArray(refusal.reasonCodes) || refusal.reasonCodes.length === 0) {
    return "No refusal or escalation information is available for this purchase.";
  }
  const explanations = refusal.reasonCodes.map((code) =>
    typeof code === "string" && code in REASON_EXPLANATIONS ? REASON_EXPLANATIONS[code as ReasonCode] : `unrecognized reason code ${String(code)}`,
  );
  const verb = refusal.decision === "ESCALATION_REQUIRED" ? "requires escalation because" : "was refused because";
  const suffix = refusal.decision === "ESCALATION_REQUIRED" && refusal.proposedAmendment
    ? " Escalating will ask the Principal to approve a one-time increase on their Ledger."
    : " This is final unless the request is reformulated within the mandate's existing limits.";
  return `This purchase ${verb} ${explanations.join("; ")}.${suffix}`;
}
