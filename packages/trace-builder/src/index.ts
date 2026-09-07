import { decisionReceiptSchema, hashCanonicalJson, hcsEnvelopeSchema, type DecisionReceipt, type Hash, type HcsEnvelope } from "@finity/schemas";

export type TraceEvent = HcsEnvelope["t"];

export function receiptHash(receipt: Omit<DecisionReceipt, "brokerSignature">): Hash {
  return hashCanonicalJson(receipt);
}

/** Build the small, privacy-preserving HCS commitment envelope. */
export function buildEnvelope(input: {
  type: TraceEvent;
  correlationId: string;
  receiptHash: Hash;
  previousReceiptHash: Hash;
  mandateId: Hash;
  transactionId?: string;
}): HcsEnvelope {
  return hcsEnvelopeSchema.parse({
    v: 1,
    t: input.type,
    cid: input.correlationId,
    h: input.receiptHash,
    p: input.previousReceiptHash,
    m: input.mandateId,
    ...(input.transactionId ? { x: { tx: input.transactionId } } : {}),
  });
}

export function assertTraceLink(envelope: HcsEnvelope, previousReceiptHash: Hash): void {
  if (envelope.p !== previousReceiptHash) throw new Error("trace envelope does not link to its predecessor");
}

export type DecisionReceiptDraft = Omit<DecisionReceipt, "kind" | "receiptId" | "brokerSignature">;
export type ReceiptSigner = (commitment: Hash) => Promise<`0x${string}`>;

/** Creates the canonical commitment the Broker Session Key signs for a decision receipt. */
export function decisionReceiptCommitment(draft: DecisionReceiptDraft): Hash {
  return hashCanonicalJson({ kind: "finity.decision", ...draft });
}

/** Signs and validates the decision receipt that anchors a purchase's hash chain. */
export async function buildDecisionReceipt(draft: DecisionReceiptDraft, sign: ReceiptSigner): Promise<DecisionReceipt> {
  const receiptId = decisionReceiptCommitment(draft);
  return decisionReceiptSchema.parse({
    kind: "finity.decision",
    receiptId,
    ...draft,
    brokerSignature: await sign(receiptId),
  });
}
