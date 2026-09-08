import {
  hashCanonicalJson,
  requestClassSchema,
  type Hash,
  type HcsEnvelope,
  type PolicySnapshot,
  type Quote,
  type ServiceManifest,
  type SignedAgentMandate,
} from "@finity/schemas";
import { discover, quote as requestQuote, select, type QuoteFetcher } from "@finity/negotiator";
import type { MirrorFetcher, RegistryRecord } from "@finity/registry-client";
import { evaluate } from "@finity/policy-engine";
import { mintCapability, type CapabilitySigner } from "@finity/capability";
import { paidFetch, type ChallengeParser } from "@finity/commerce-adapter";
import { buildDecisionReceipt, buildEnvelope, type ReceiptSigner } from "@finity/trace-builder";
import type { Intent, Purchase, Transition } from "./index.js";

function listIncludes(csv: string, value: string): boolean {
  return csv.split(",").map((item) => item.trim()).filter(Boolean).includes(value);
}

const ZERO_HASH: Hash = `0x${"00".repeat(32)}`;

export type MandateRecord = { mandateId: Hash; mandate: SignedAgentMandate; mandateVersion: string; lastReceiptHash: Hash };

/** Tracks the full off-chain mandate content and each mandate's trace hash-chain tip. On-chain state (status, consumption) is read separately via `registryRecord`. */
export class MandateStore {
  private readonly mandates = new Map<Hash, MandateRecord>();

  set(mandateId: Hash, mandate: SignedAgentMandate, mandateVersion = "1"): void {
    this.mandates.set(mandateId, { mandateId, mandate, mandateVersion, lastReceiptHash: ZERO_HASH });
  }

  get(mandateId: Hash): MandateRecord | undefined {
    return this.mandates.get(mandateId);
  }

  recordReceiptHash(mandateId: Hash, hash: Hash): void {
    const record = this.mandates.get(mandateId);
    if (!record) throw new Error("mandate not found");
    record.lastReceiptHash = hash;
  }
}

export type SnapshotInput = {
  mandate: SignedAgentMandate;
  manifest: ServiceManifest;
  quote: Quote;
  requestDataClass: number;
  registryRecord: RegistryRecord;
  now: number;
};

/**
 * Assembles the PolicySnapshot the policy engine evaluates. Real signature
 * verification for the mandate/quote/manifest and on-chain principal
 * recovery are @finity/verifier's job (no digest/recovery scheme has been
 * decided yet); this seam lets the executor stay fully wired and testable
 * ahead of that decision.
 */
export type SnapshotBuilder = (input: SnapshotInput) => PolicySnapshot;

export type PurchaseDependencies = {
  mandateStore: MandateStore;
  now(): number;
  topicId: string;
  mirrorNodeUrl?: string;
  mirrorFetcher?: MirrorFetcher;
  quoteFetcher?: QuoteFetcher;
  registryRecord(mandateId: Hash): Promise<RegistryRecord>;
  /** Reserves the quoted amount on-chain and returns the reservation ID (from the ReservationCreated event, not the write's transaction hash). */
  reserve(mandateId: Hash, amountTinybar: string): Promise<Hash>;
  finalize(reservationId: Hash, actualTinybar: string): Promise<void>;
  release(reservationId: Hash): Promise<void>;
  buildSnapshot: SnapshotBuilder;
  signCapability: CapabilitySigner;
  signReceipt: ReceiptSigner;
  resourceUrl(manifest: ServiceManifest, methodId: string): string;
  spendAccountId: string;
  brokerSessionKey: string;
  brokerAddress: `0x${string}`;
  parseChallenges: ChallengeParser;
  paymentTransaction?(response: Response): string | undefined;
  fetchImpl?: typeof fetch;
  submitTrace?(envelope: HcsEnvelope): Promise<string | undefined>;
};

function eligibleMethodId(intent: Intent, mandate: SignedAgentMandate, manifest: ServiceManifest): string | undefined {
  if (intent.methodId) return manifest.methods.some((method) => method.id === intent.methodId) ? intent.methodId : undefined;
  return manifest.methods.find((method) => listIncludes(mandate.allowedMethods, method.id))?.id;
}

/**
 * Runs the full F4 autonomous-purchase pipeline: discovery, negotiation,
 * policy evaluation, on-chain reservation, capability-scoped payment,
 * delivery, and reconciliation, hash-chaining an HCS trace envelope after
 * each externally-visible step. Every I/O and signing boundary is injected
 * so the pipeline is testable without a network, a registry contract, or a
 * Ledger.
 */
export function createIntentExecutor(deps: PurchaseDependencies) {
  return async function runPurchase(purchase: Purchase, transition: Transition): Promise<void> {
    const { intent } = purchase;
    const mandateRecord = deps.mandateStore.get(intent.mandateId);
    if (!mandateRecord) {
      transition({ type: "FAILED_DISCOVERY" });
      return;
    }
    const { mandate, mandateVersion } = mandateRecord;

    let manifests: ServiceManifest[];
    try {
      manifests = await discover(
        { allowedServices: mandate.allowedServices, allowedMethods: mandate.allowedMethods, serviceHint: intent.serviceHint },
        { topicId: deps.topicId, mirrorNodeUrl: deps.mirrorNodeUrl, fetcher: deps.mirrorFetcher },
      );
    } catch {
      transition({ type: "FAILED_DISCOVERY" });
      return;
    }
    if (manifests.length === 0) {
      transition({ type: "FAILED_DISCOVERY" });
      return;
    }
    transition({ type: "DISCOVERED" });

    const now = deps.now();
    const requestClass = requestClassSchema.safeParse(intent.requestClass);
    const quotesByManifest = new Map<string, ServiceManifest>();
    const quotes: Quote[] = [];
    if (requestClass.success) {
      for (const manifest of manifests) {
        const methodId = eligibleMethodId(intent, mandate, manifest);
        if (!methodId) continue;
        try {
          const offer = await requestQuote(manifest, methodId, requestClass.data, { now, fetcher: deps.quoteFetcher });
          quotes.push(offer);
          quotesByManifest.set(offer.serviceId, manifest);
        } catch {
          continue;
        }
      }
    }
    if (quotes.length === 0) {
      transition({ type: "FAILED_QUOTE" });
      return;
    }
    transition({ type: "QUOTED" });

    const selectedQuote = select(quotes, intent.constraints);
    const manifest = quotesByManifest.get(selectedQuote.serviceId);
    if (!manifest) {
      transition({ type: "FAILED_EVALUATION" });
      return;
    }

    transition({ type: "EVALUATING" });
    let registryRecord: RegistryRecord;
    try {
      registryRecord = await deps.registryRecord(intent.mandateId);
    } catch {
      transition({ type: "FAILED_EVALUATION" });
      return;
    }
    const snapshot = deps.buildSnapshot({ mandate, manifest, quote: selectedQuote, requestDataClass: intent.dataClass, registryRecord, now });
    const decision = evaluate(snapshot);

    // Every decision - REFUSED, ESCALATION_REQUIRED, or AUTHORIZED - gets a
    // signed receipt and an HCS DECISION commitment (spec F5: a refusal is
    // still a signed, traceable event, not silence). The mandate's
    // hash-chain tip advances here regardless of outcome, so a later
    // purchase's DECISION correctly links to this one even if this one was
    // refused.
    const decisionReceipt = await buildDecisionReceipt(
      {
        correlationId: purchase.correlationId,
        mandateId: intent.mandateId,
        mandateVersion,
        decision: decision.decision,
        reasonCodes: decision.reasonCodes,
        inputCommitment: decision.inputCommitment,
        policyHash: decision.policyHash,
        quoteHash: hashCanonicalJson(selectedQuote),
        manifestHash: selectedQuote.manifestHash,
        evaluatedLimits: decision.evaluatedLimits,
        at: now,
        prevReceiptHash: mandateRecord.lastReceiptHash,
      },
      deps.signReceipt,
    );
    const decisionEnvelope = buildEnvelope({
      type: "DECISION", correlationId: purchase.correlationId, receiptHash: decisionReceipt.receiptId as Hash,
      previousReceiptHash: mandateRecord.lastReceiptHash, mandateId: intent.mandateId,
    });
    await deps.submitTrace?.(decisionEnvelope);
    deps.mandateStore.recordReceiptHash(intent.mandateId, decisionEnvelope.h as Hash);

    if (decision.decision === "REFUSED") {
      transition({ type: "REFUSED" }, { refusal: { ...decision, receiptId: decisionReceipt.receiptId } });
      return;
    }
    if (decision.decision === "ESCALATION_REQUIRED") {
      transition({ type: "ESCALATION_REQUIRED" }, { refusal: { ...decision, receiptId: decisionReceipt.receiptId } });
      return;
    }
    transition({ type: "AUTHORIZED" });

    let reservationId: Hash;
    try {
      reservationId = await deps.reserve(intent.mandateId, decision.reservationRequest?.amount ?? selectedQuote.amount);
    } catch {
      transition({ type: "FAILED_RESERVATION" });
      return;
    }
    transition({ type: "RESERVED" });

    const capability = await mintCapability(
      {
        mandateId: intent.mandateId, mandateVersion, agent: intent.agentUaid, broker: deps.brokerAddress,
        serviceId: selectedQuote.serviceId, methodId: selectedQuote.methodId, quoteHash: hashCanonicalJson(selectedQuote),
        maxAmount: selectedQuote.amount, maxUnits: selectedQuote.requestClass.units, dataClassMax: intent.dataClass,
        issuedAt: now, expiresAt: now + 90, reservationId,
      },
      deps.signCapability,
    );

    let response: Response;
    try {
      response = await paidFetch({
        capability, quote: selectedQuote, spendAccountId: deps.spendAccountId, brokerSessionKey: deps.brokerSessionKey,
        url: deps.resourceUrl(manifest, selectedQuote.methodId), fetchImpl: deps.fetchImpl, parseChallenges: deps.parseChallenges,
      });
      if (!response.ok) {
        const body = (await response.clone().text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
        throw new Error(`provider returned HTTP ${response.status}${body ? `: ${body}` : ""}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "unknown error";
      console.error(`[finityd] payment failed: ${message}`);
      await deps.release(reservationId).catch(() => undefined);
      transition({ type: "FAILED_PAYMENT" });
      return;
    }
    transition({ type: "PAID" });
    const paymentEnvelope = buildEnvelope({
      type: "PAYMENT", correlationId: purchase.correlationId,
      receiptHash: hashCanonicalJson({ reservationId, amount: selectedQuote.amount }),
      previousReceiptHash: decisionReceipt.receiptId as Hash, mandateId: intent.mandateId,
      transactionId: deps.paymentTransaction?.(response),
    });
    await deps.submitTrace?.(paymentEnvelope);
    deps.mandateStore.recordReceiptHash(intent.mandateId, paymentEnvelope.h as Hash);

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      await deps.release(reservationId).catch(() => undefined);
      transition({ type: "FAILED_DELIVERY" });
      return;
    }
    transition({ type: "DELIVERED" }, { result });
    const usageEnvelope = buildEnvelope({
      type: "USAGE", correlationId: purchase.correlationId, receiptHash: hashCanonicalJson(result),
      previousReceiptHash: paymentEnvelope.h as Hash, mandateId: intent.mandateId,
    });
    await deps.submitTrace?.(usageEnvelope);
    deps.mandateStore.recordReceiptHash(intent.mandateId, usageEnvelope.h as Hash);

    try {
      await deps.finalize(reservationId, selectedQuote.amount);
    } catch {
      transition({ type: "FAILED_RECONCILIATION" });
      return;
    }
    transition({ type: "RECONCILED" });
    const reconciledEnvelope = buildEnvelope({
      type: "RECONCILED", correlationId: purchase.correlationId,
      receiptHash: hashCanonicalJson({ reservationId, actual: selectedQuote.amount }),
      previousReceiptHash: usageEnvelope.h as Hash, mandateId: intent.mandateId,
    });
    await deps.submitTrace?.(reconciledEnvelope);
    deps.mandateStore.recordReceiptHash(intent.mandateId, reconciledEnvelope.h as Hash);
  };
}
