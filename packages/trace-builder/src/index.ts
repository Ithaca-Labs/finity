import { hashCanonicalJson, hcsEnvelopeSchema, type DecisionReceipt, type Hash, type HcsEnvelope } from "@finity/schemas";

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
