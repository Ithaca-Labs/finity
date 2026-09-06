import {
  formatDisplay,
  formatPeriodDisplay,
  formatUntilDisplay,
  hashCanonicalJson,
  policySnapshotSchema,
  type Hash,
  type PolicySnapshot,
} from "@finity/schemas";

export const REASON_CODES = [
  "MANDATE_INACTIVE",
  "MANDATE_EXPIRED",
  "MANDATE_SUPERSEDED",
  "SIGNATURE_INVALID",
  "DISPLAY_MISMATCH",
  "AGENT_MISMATCH",
  "BROKER_NOT_AUTHORIZED",
  "PROVIDER_NOT_ALLOWED",
  "SERVICE_NOT_ALLOWED",
  "METHOD_NOT_ALLOWED",
  "ASSET_NOT_ALLOWED",
  "QUOTE_INVALID",
  "QUOTE_EXPIRED",
  "PAYMENT_TERMS_MISMATCH",
  "PRICE_LIMIT_EXCEEDED",
  "UNIT_LIMIT_EXCEEDED",
  "PERIOD_BUDGET_EXCEEDED",
  "LIFETIME_BUDGET_EXCEEDED",
  "DATA_POLICY_VIOLATION",
  "POLICY_VERSION_MISMATCH",
  "REVOCATION_ACTIVE",
  "CAPABILITY_REPLAY",
  "STATE_UNAVAILABLE",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export type Decision = "AUTHORIZED" | "REFUSED" | "ESCALATION_REQUIRED";

const LIMIT_REASON_CODES = new Set<ReasonCode>([
  "PRICE_LIMIT_EXCEEDED",
  "UNIT_LIMIT_EXCEEDED",
  "PERIOD_BUDGET_EXCEEDED",
  "LIFETIME_BUDGET_EXCEEDED",
]);

export const POLICY_DESCRIPTOR = {
  package: "@finity/policy-engine",
  version: "0.1.0",
  predicateOrder: REASON_CODES.filter((code) => code !== "CAPABILITY_REPLAY" && code !== "STATE_UNAVAILABLE"),
  decisionMapping: {
    limits: "ESCALATION_REQUIRED",
    otherFailures: "REFUSED",
    noFailures: "AUTHORIZED",
  },
} as const;

export const POLICY_HASH = hashCanonicalJson(POLICY_DESCRIPTOR);
export const MANDATE_AMENDMENT_FIELD_MAX_PER_REQUEST = 0;

export type EvaluatedLimits = {
  perRequest: { limit: string; requested: string };
  period: { limit: string; consumed: string; requested: string };
  lifetime: { limit: string; consumed: string; requested: string };
};

export type ProposedAmendment = {
  field: typeof MANDATE_AMENDMENT_FIELD_MAX_PER_REQUEST;
  newValue: string;
  newValueText: string;
  scopeServiceId: string;
  oneTime: true;
  validUntil: number;
  nonce: string;
};

export type PolicyResult = {
  decision: Decision;
  reasonCodes: ReasonCode[];
  evaluatedLimits: EvaluatedLimits;
  reservationRequest?: { amount: string };
  proposedAmendment?: ProposedAmendment;
  policyHash: Hash;
  inputCommitment: Hash;
};

function pushIf(failures: ReasonCode[], condition: boolean, code: ReasonCode): void {
  if (condition) failures.push(code);
}

function listIncludes(csv: string, value: string): boolean {
  return csv.split(",").map((item) => item.trim()).filter(Boolean).includes(value);
}

function equalAsset(mandateAsset: string, quoteAsset: string): boolean {
  return mandateAsset === "HBAR" ? quoteAsset === "0.0.0" : mandateAsset === quoteAsset;
}

function unsignedManifestHash(snapshot: PolicySnapshot): Hash {
  const { signature: _signature, ...unsignedManifest } = snapshot.manifest;
  return hashCanonicalJson(unsignedManifest);
}

function displayMatches(snapshot: PolicySnapshot): boolean {
  const { mandate } = snapshot;
  return snapshot.displayValid
    && mandate.maxPerRequestText === formatDisplay(mandate.maxPerRequest, mandate.asset)
    && mandate.maxPerPeriodText === formatPeriodDisplay(mandate.maxPerPeriod, mandate.asset, mandate.periodSeconds)
    && mandate.maxLifetimeText === `${formatDisplay(mandate.maxLifetime, mandate.asset)} total`
    && mandate.validUntilText === formatUntilDisplay(mandate.validUntil);
}

function evaluateParsed(snapshot: PolicySnapshot): PolicyResult {
  const failures: ReasonCode[] = [];
  const { mandate, quote, manifest } = snapshot;
  const expectedAsset = manifest.pricing.asset;
  const periodRequested = BigInt(quote.amount);
  const currentPeriodConsumed = BigInt(snapshot.currentPeriodConsumed);
  const currentLifetimeConsumed = BigInt(snapshot.currentLifetimeConsumed);
  const maxPerRequest = BigInt(mandate.maxPerRequest);
  const maxPerPeriod = BigInt(mandate.maxPerPeriod);
  const maxLifetime = BigInt(mandate.maxLifetime);
  const quoteUnits = BigInt(quote.requestClass.units);
  const maxUnits = BigInt(mandate.maxUnitsPerRequest);

  pushIf(failures, snapshot.mandateStatus !== "ACTIVE", "MANDATE_INACTIVE");
  pushIf(failures, snapshot.now >= mandate.validUntil || snapshot.now < mandate.validFrom, "MANDATE_EXPIRED");
  pushIf(failures, snapshot.mandateSuperseded || snapshot.mandateStatus === "SUPERSEDED", "MANDATE_SUPERSEDED");
  pushIf(failures, !snapshot.signatureValid, "SIGNATURE_INVALID");
  pushIf(failures, !displayMatches(snapshot), "DISPLAY_MISMATCH");
  pushIf(failures, snapshot.agentUaid !== mandate.agent, "AGENT_MISMATCH");
  pushIf(failures, snapshot.brokerAddress.toLowerCase() !== mandate.broker.toLowerCase(), "BROKER_NOT_AUTHORIZED");
  pushIf(failures, !snapshot.providerAllowed, "PROVIDER_NOT_ALLOWED");
  pushIf(failures, !listIncludes(mandate.allowedServices, snapshot.serviceId), "SERVICE_NOT_ALLOWED");
  pushIf(failures, !listIncludes(mandate.allowedMethods, snapshot.methodId), "METHOD_NOT_ALLOWED");
  pushIf(failures, !equalAsset(mandate.asset, quote.asset), "ASSET_NOT_ALLOWED");
  pushIf(
    failures,
    !snapshot.manifestSignatureValid
      || !snapshot.quoteSignatureValid
      || snapshot.quoteNonceReused
      || quote.serviceId !== snapshot.serviceId
      || quote.methodId !== snapshot.methodId
      || quote.manifestHash !== unsignedManifestHash(snapshot),
    "QUOTE_INVALID",
  );
  pushIf(
    failures,
    quote.expiresAt < snapshot.now
      || BigInt(snapshot.now) - BigInt(quote.issuedAt) > BigInt(mandate.quoteMaxAgeSeconds),
    "QUOTE_EXPIRED",
  );
  pushIf(
    failures,
    quote.payTo !== manifest.payTo || quote.asset !== expectedAsset || quote.network !== manifest.pricing.network,
    "PAYMENT_TERMS_MISMATCH",
  );
  pushIf(failures, periodRequested > maxPerRequest, "PRICE_LIMIT_EXCEEDED");
  pushIf(failures, maxUnits !== 0n && quoteUnits > maxUnits, "UNIT_LIMIT_EXCEEDED");
  pushIf(failures, currentPeriodConsumed + periodRequested > maxPerPeriod, "PERIOD_BUDGET_EXCEEDED");
  pushIf(failures, currentLifetimeConsumed + periodRequested > maxLifetime, "LIFETIME_BUDGET_EXCEEDED");
  const method = manifest.methods.find((candidate) => candidate.id === snapshot.methodId);
  pushIf(
    failures,
    snapshot.requestDataClass > mandate.dataClass
      || method === undefined
      || snapshot.requestDataClass > method.dataClassMax,
    "DATA_POLICY_VIOLATION",
  );
  pushIf(failures, snapshot.policyHash !== mandate.policyHash || POLICY_HASH !== mandate.policyHash, "POLICY_VERSION_MISMATCH");
  pushIf(failures, snapshot.revocationActive, "REVOCATION_ACTIVE");

  const evaluatedLimits: EvaluatedLimits = {
    perRequest: { limit: mandate.maxPerRequest, requested: quote.amount },
    period: { limit: mandate.maxPerPeriod, consumed: snapshot.currentPeriodConsumed, requested: quote.amount },
    lifetime: { limit: mandate.maxLifetime, consumed: snapshot.currentLifetimeConsumed, requested: quote.amount },
  };
  const inputCommitment = hashCanonicalJson(snapshot);
  if (failures.length === 0) {
    return {
      decision: "AUTHORIZED",
      reasonCodes: [],
      evaluatedLimits,
      reservationRequest: { amount: quote.amount },
      policyHash: POLICY_HASH,
      inputCommitment,
    };
  }

  const onlyLimits = failures.every((code) => LIMIT_REASON_CODES.has(code));
  if (!onlyLimits) {
    return { decision: "REFUSED", reasonCodes: failures, evaluatedLimits, policyHash: POLICY_HASH, inputCommitment };
  }

  const proposedAmount = [maxPerRequest, periodRequested, currentPeriodConsumed + periodRequested, currentLifetimeConsumed + periodRequested]
    .reduce((largest, value) => (value > largest ? value : largest), 0n)
    .toString();
  const proposedAmendment: ProposedAmendment = {
    field: MANDATE_AMENDMENT_FIELD_MAX_PER_REQUEST,
    newValue: proposedAmount,
    newValueText: formatDisplay(proposedAmount, mandate.asset),
    scopeServiceId: snapshot.serviceId,
    oneTime: true,
    validUntil: snapshot.now + 120,
    nonce: mandate.nonce,
  };
  return {
    decision: "ESCALATION_REQUIRED",
    reasonCodes: failures,
    evaluatedLimits,
    proposedAmendment,
    policyHash: POLICY_HASH,
    inputCommitment,
  };
}

export function evaluate(input: unknown): PolicyResult {
  const parsed = policySnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return {
      decision: "REFUSED",
      reasonCodes: ["STATE_UNAVAILABLE"],
      evaluatedLimits: {
        perRequest: { limit: "0", requested: "0" },
        period: { limit: "0", consumed: "0", requested: "0" },
        lifetime: { limit: "0", consumed: "0", requested: "0" },
      },
      policyHash: POLICY_HASH,
      inputCommitment: hashCanonicalJson({ state: "unavailable" }),
    };
  }
  return evaluateParsed(parsed.data);
}
