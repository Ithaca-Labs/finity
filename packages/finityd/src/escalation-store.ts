import { randomUUID } from "node:crypto";
import type { Hash } from "@finity/schemas";

/** Mirrors policy-engine's ProposedAmendment shape without importing the package, so this stays a plain data type. */
export type ProposedAmendment = {
  field: number;
  newValue: string;
  newValueText: string;
  scopeServiceId: string;
  oneTime: boolean;
  validUntil: number;
  nonce: string;
};

export type EscalationStatus = "PENDING" | "APPROVED" | "REJECTED";

export type Escalation = {
  escalationId: string;
  correlationId: string;
  mandateId: Hash;
  receiptId: Hash;
  proposedAmendment: ProposedAmendment;
  status: EscalationStatus;
  createdAt: number;
};

/**
 * Tracks escalations proposed by finity_request_escalation until the
 * Principal approves (signs a MandateAmendment on their Ledger) or rejects
 * them, per user story 19. In-memory: an escalation only outlives one
 * finityd run, same tradeoff as MandateStore.
 */
export class EscalationStore {
  private readonly escalations = new Map<string, Escalation>();

  create(input: { correlationId: string; mandateId: Hash; receiptId: Hash; proposedAmendment: ProposedAmendment }): Escalation {
    const escalation: Escalation = { escalationId: randomUUID(), status: "PENDING", createdAt: Math.floor(Date.now() / 1000), ...input };
    this.escalations.set(escalation.escalationId, escalation);
    return escalation;
  }

  get(escalationId: string): Escalation | undefined {
    return this.escalations.get(escalationId);
  }

  listPending(): Escalation[] {
    return [...this.escalations.values()].filter((escalation) => escalation.status === "PENDING");
  }

  resolve(escalationId: string, status: "APPROVED" | "REJECTED"): Escalation | undefined {
    const escalation = this.escalations.get(escalationId);
    if (!escalation) return undefined;
    escalation.status = status;
    return escalation;
  }
}
