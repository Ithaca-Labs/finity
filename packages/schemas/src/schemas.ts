import { z } from "zod";

export const integerString = z.string().regex(/^(0|[1-9][0-9]*)$/, "unsigned integer string");
export const hederaAccountId = z.string().regex(/^0\.0\.[1-9][0-9]*$/, "Hedera account ID");
export const htsTokenId = z.string().regex(/^0\.0\.[1-9][0-9]*$/, "HTS token ID");
export const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "EVM address");
export const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bytes32 hex value");
export const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/, "65-byte hex signature");
export const timestamp = z.number().int().nonnegative();

const nonEmpty = z.string().min(1);

export const agentMandateSchema = z.object({
  agent: nonEmpty,
  broker: evmAddress,
  spendAccount: hederaAccountId,
  allowedServices: nonEmpty,
  allowedMethods: nonEmpty,
  asset: z.union([z.literal("HBAR"), htsTokenId]),
  maxPerRequest: integerString,
  maxPerRequestText: nonEmpty,
  maxPerPeriod: integerString,
  maxPerPeriodText: nonEmpty,
  periodSeconds: integerString,
  maxLifetime: integerString,
  maxLifetimeText: nonEmpty,
  maxUnitsPerRequest: integerString,
  validFrom: timestamp,
  validUntil: timestamp,
  validUntilText: nonEmpty,
  quoteMaxAgeSeconds: integerString,
  dataClass: z.number().int().min(0).max(2),
  escalationRule: nonEmpty,
  policyHash: bytes32,
  nonce: integerString,
  predecessor: bytes32,
});
export type AgentMandate = z.infer<typeof agentMandateSchema>;

export const signedAgentMandateSchema = agentMandateSchema.extend({
  signature,
  mandateId: bytes32,
});
export type SignedAgentMandate = z.infer<typeof signedAgentMandateSchema>;

export const mandateAmendmentSchema = z.object({
  mandateId: bytes32,
  field: z.number().int().nonnegative(),
  newValue: integerString,
  newValueText: nonEmpty,
  scopeServiceId: z.string(),
  oneTime: z.boolean(),
  validUntil: timestamp,
  nonce: integerString,
});
export type MandateAmendment = z.infer<typeof mandateAmendmentSchema>;

export const revocationSchema = z.object({
  mandateId: bytes32,
  nonce: integerString,
  reason: nonEmpty,
});
export type Revocation = z.infer<typeof revocationSchema>;

export const serviceMethodSchema = z.object({
  id: nonEmpty,
  inputSchemaRef: nonEmpty,
  outputSchemaRef: nonEmpty,
  dataClassMax: z.number().int().min(0).max(2),
});

export const pricingSchema = z.object({
  model: z.enum(["fixed", "per_unit"]),
  unit: z.enum(["call", "char", "token", "row", "byte", "second"]),
  asset: z.literal("0.0.0").or(htsTokenId),
  network: z.enum(["hedera:testnet", "hedera:mainnet"]),
});

export const serviceManifestSchema = z.object({
  kind: z.literal("finity.manifest"),
  version: z.literal(1),
  serviceId: nonEmpty,
  provider: z.object({
    uaid: nonEmpty,
    hederaAccount: hederaAccountId,
    signingKey: nonEmpty,
  }),
  name: nonEmpty,
  description: nonEmpty,
  baseUrl: z.string().url(),
  methods: z.array(serviceMethodSchema).min(1),
  pricing: pricingSchema,
  quoteEndpoint: z.string().startsWith("/"),
  payTo: hederaAccountId,
  receiptKey: nonEmpty,
  healthEndpoint: z.string().startsWith("/"),
  publishedAt: timestamp,
  signature,
});
export type ServiceManifest = z.infer<typeof serviceManifestSchema>;

export const requestClassSchema = z.object({
  unit: z.enum(["call", "char", "token", "row", "byte", "second"]),
  units: integerString,
});
export type RequestClass = z.infer<typeof requestClassSchema>;

export const quoteSchema = z.object({
  kind: z.literal("finity.quote"),
  serviceId: nonEmpty,
  methodId: nonEmpty,
  manifestHash: bytes32,
  requestClass: requestClassSchema,
  amount: integerString,
  asset: z.literal("0.0.0").or(htsTokenId),
  network: z.enum(["hedera:testnet", "hedera:mainnet"]),
  payTo: hederaAccountId,
  nonce: z.string().uuid(),
  issuedAt: timestamp,
  expiresAt: timestamp,
  signature,
});
export type Quote = z.infer<typeof quoteSchema>;

export const capabilitySchema = z.object({
  kind: z.literal("finity.capability"),
  capabilityId: bytes32,
  mandateId: bytes32,
  mandateVersion: integerString,
  agent: nonEmpty,
  broker: evmAddress,
  serviceId: nonEmpty,
  methodId: nonEmpty,
  quoteHash: bytes32,
  maxAmount: integerString,
  maxUnits: integerString,
  dataClassMax: z.number().int().min(0).max(2),
  issuedAt: timestamp,
  expiresAt: timestamp,
  reservationId: bytes32,
  brokerSignature: signature,
});
export type Capability = z.infer<typeof capabilitySchema>;

export const usageReceiptSchema = z.object({
  kind: z.literal("finity.usage"),
  serviceId: nonEmpty,
  quoteNonce: z.string().uuid(),
  unitsActual: integerString,
  amountCharged: integerString,
  settlementTxId: nonEmpty,
  resultHash: bytes32,
  issuedAt: timestamp,
  signature,
});
export type UsageReceipt = z.infer<typeof usageReceiptSchema>;

export const evaluatedLimitSchema = z.object({
  limit: integerString,
  requested: integerString,
  consumed: integerString.optional(),
});

export const decisionReceiptSchema = z.object({
  kind: z.literal("finity.decision"),
  receiptId: bytes32,
  correlationId: z.string().uuid(),
  mandateId: bytes32,
  mandateVersion: integerString,
  decision: z.enum(["AUTHORIZED", "REFUSED", "ESCALATION_REQUIRED"]),
  reasonCodes: z.array(nonEmpty),
  inputCommitment: bytes32,
  policyHash: bytes32,
  quoteHash: bytes32,
  manifestHash: bytes32,
  evaluatedLimits: z.object({
    perRequest: evaluatedLimitSchema,
    period: evaluatedLimitSchema,
    lifetime: evaluatedLimitSchema,
  }),
  reservationId: bytes32.optional(),
  at: timestamp,
  prevReceiptHash: bytes32,
  brokerSignature: signature,
});
export type DecisionReceipt = z.infer<typeof decisionReceiptSchema>;

export const hcsEnvelopeSchema = z.object({
  v: z.literal(1),
  t: z.enum(["DECISION", "PAYMENT", "USAGE", "RECONCILED", "ESCALATION", "REVOKED", "MANDATE_ACTIVATED"]),
  cid: z.string().uuid(),
  h: bytes32,
  p: bytes32,
  m: bytes32,
  x: z.object({ tx: nonEmpty }).optional(),
});
export type HcsEnvelope = z.infer<typeof hcsEnvelopeSchema>;

export const policySnapshotSchema = z.object({
  mandate: agentMandateSchema,
  mandateStatus: z.enum(["NONE", "ACTIVE", "EXHAUSTED", "EXPIRED", "REVOKED", "SUPERSEDED"]),
  mandateSuperseded: z.boolean(),
  principal: evmAddress,
  signatureValid: z.boolean(),
  displayValid: z.boolean(),
  agentUaid: nonEmpty,
  brokerAddress: evmAddress,
  providerAllowed: z.boolean(),
  providerAccount: hederaAccountId,
  serviceId: nonEmpty,
  methodId: nonEmpty,
  quote: quoteSchema,
  manifest: serviceManifestSchema,
  manifestSignatureValid: z.boolean(),
  quoteSignatureValid: z.boolean(),
  quoteNonceReused: z.boolean(),
  requestDataClass: z.number().int().min(0).max(2),
  policyHash: bytes32,
  currentPeriodConsumed: integerString,
  currentLifetimeConsumed: integerString,
  now: timestamp,
  revocationActive: z.boolean(),
});
export type PolicySnapshot = z.infer<typeof policySnapshotSchema>;

export const providerAccessBundleSchema = z.object({
  credentials: z.record(z.string()),
  endpointAllowlist: z.array(z.string().url()),
  injection: z.object({
    location: z.enum(["header", "query"]),
    name: nonEmpty,
    format: nonEmpty,
  }),
});
export type ProviderAccessBundle = z.infer<typeof providerAccessBundleSchema>;

export const brokerBundleSchema = z.object({
  brokerSessionKey: nonEmpty,
  spendAccountId: hederaAccountId,
  brokerUaid: nonEmpty,
});
export type BrokerBundle = z.infer<typeof brokerBundleSchema>;
