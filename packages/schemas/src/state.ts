export type MandateState = "DRAFT" | "SIGNED" | "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "REVOKED" | "SUPERSEDED";
export type MandateEvent =
  | { type: "SIGNED" }
  | { type: "ACTIVATED" }
  | { type: "EXHAUSTED" }
  | { type: "EXPIRED" }
  | { type: "REVOKED" }
  | { type: "SUPERSEDED" };

export type PurchaseState =
  | "INTENT"
  | "DISCOVERED"
  | "QUOTED"
  | "EVALUATING"
  | "AUTHORIZED"
  | "REFUSED"
  | "ESCALATION_REQUIRED"
  | "RESERVED"
  | "PAID"
  | "DELIVERED"
  | "RECONCILED"
  | "FAILED_DISCOVERY"
  | "FAILED_QUOTE"
  | "FAILED_EVALUATION"
  | "FAILED_RESERVATION"
  | "FAILED_PAYMENT"
  | "FAILED_DELIVERY"
  | "FAILED_RECONCILIATION";
export type PurchaseEvent =
  | { type: "DISCOVERED" }
  | { type: "QUOTED" }
  | { type: "EVALUATING" }
  | { type: "AUTHORIZED" }
  | { type: "REFUSED" }
  | { type: "ESCALATION_REQUIRED" }
  | { type: "RESERVED" }
  | { type: "PAID" }
  | { type: "DELIVERED" }
  | { type: "RECONCILED" }
  | { type: "FAILED_DISCOVERY" }
  | { type: "FAILED_QUOTE" }
  | { type: "FAILED_EVALUATION" }
  | { type: "FAILED_RESERVATION" }
  | { type: "FAILED_PAYMENT" }
  | { type: "FAILED_DELIVERY" }
  | { type: "FAILED_RECONCILIATION" };

export type CapabilityState = "ISSUED" | "LEASED" | "CONSUMED" | "EXPIRED" | "REVOKED";
export type CapabilityEvent =
  | { type: "LEASED" }
  | { type: "CONSUMED" }
  | { type: "EXPIRED" }
  | { type: "REVOKED" };

export class IllegalTransition extends Error {
  constructor(machine: string, state: string, event: string) {
    super(`Illegal ${machine} transition: ${state} -> ${event}`);
    this.name = "IllegalTransition";
  }
}

export function reduceMandate(state: MandateState, event: MandateEvent): MandateState {
  const next: Record<MandateState, Partial<Record<MandateEvent["type"], MandateState>>> = {
    DRAFT: { SIGNED: "SIGNED" },
    SIGNED: { ACTIVATED: "ACTIVE" },
    ACTIVE: { EXHAUSTED: "EXHAUSTED", EXPIRED: "EXPIRED", REVOKED: "REVOKED", SUPERSEDED: "SUPERSEDED" },
    EXHAUSTED: {},
    EXPIRED: {},
    REVOKED: {},
    SUPERSEDED: {},
  };
  const result = next[state][event.type];
  if (!result) throw new IllegalTransition("mandate", state, event.type);
  return result;
}

const purchaseTransitions: Partial<Record<PurchaseState, Partial<Record<PurchaseEvent["type"], PurchaseState>>>> = {
  INTENT: { DISCOVERED: "DISCOVERED", FAILED_DISCOVERY: "FAILED_DISCOVERY" },
  DISCOVERED: { QUOTED: "QUOTED", FAILED_QUOTE: "FAILED_QUOTE" },
  QUOTED: { EVALUATING: "EVALUATING", FAILED_EVALUATION: "FAILED_EVALUATION" },
  EVALUATING: { AUTHORIZED: "AUTHORIZED", REFUSED: "REFUSED", ESCALATION_REQUIRED: "ESCALATION_REQUIRED" },
  AUTHORIZED: { RESERVED: "RESERVED", FAILED_RESERVATION: "FAILED_RESERVATION" },
  RESERVED: { PAID: "PAID", FAILED_PAYMENT: "FAILED_PAYMENT" },
  PAID: { DELIVERED: "DELIVERED", FAILED_DELIVERY: "FAILED_DELIVERY" },
  DELIVERED: { RECONCILED: "RECONCILED", FAILED_RECONCILIATION: "FAILED_RECONCILIATION" },
};

export function reducePurchase(state: PurchaseState, event: PurchaseEvent): PurchaseState {
  const result = purchaseTransitions[state]?.[event.type];
  if (!result) throw new IllegalTransition("purchase", state, event.type);
  return result;
}

export function reduceCapability(state: CapabilityState, event: CapabilityEvent): CapabilityState {
  const next: Record<CapabilityState, Partial<Record<CapabilityEvent["type"], CapabilityState>>> = {
    ISSUED: { LEASED: "LEASED", EXPIRED: "EXPIRED", REVOKED: "REVOKED" },
    LEASED: { CONSUMED: "CONSUMED", EXPIRED: "EXPIRED", REVOKED: "REVOKED" },
    CONSUMED: {},
    EXPIRED: {},
    REVOKED: {},
  };
  const result = next[state][event.type];
  if (!result) throw new IllegalTransition("capability", state, event.type);
  return result;
}

