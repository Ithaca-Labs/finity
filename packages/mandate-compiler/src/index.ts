import {
  agentMandateSchema,
  formatDisplay,
  formatPeriodDisplay,
  formatUntilDisplay,
  type AgentMandate,
  type Hash,
} from "@finity/schemas";
import { hashTypedData } from "viem";

export const MANDATE_DOMAIN_NAME = "FinityMandate" as const;
export const MANDATE_DOMAIN_VERSION = "1" as const;
export const MANDATE_CHAIN_ID = 296 as const;
export const MANDATE_DERIVATION_PATH = "44'/60'/0'/0/0" as const;

export { formatDisplay } from "@finity/schemas";

export const agentMandateTypes = [
  { name: "agent", type: "string" },
  { name: "broker", type: "address" },
  { name: "spendAccount", type: "string" },
  { name: "allowedServices", type: "string" },
  { name: "allowedMethods", type: "string" },
  { name: "asset", type: "string" },
  { name: "maxPerRequest", type: "uint256" },
  { name: "maxPerRequestText", type: "string" },
  { name: "maxPerPeriod", type: "uint256" },
  { name: "maxPerPeriodText", type: "string" },
  { name: "periodSeconds", type: "uint256" },
  { name: "maxLifetime", type: "uint256" },
  { name: "maxLifetimeText", type: "string" },
  { name: "maxUnitsPerRequest", type: "uint256" },
  { name: "validFrom", type: "uint256" },
  { name: "validUntil", type: "uint256" },
  { name: "validUntilText", type: "string" },
  { name: "quoteMaxAgeSeconds", type: "uint256" },
  { name: "dataClass", type: "uint8" },
  { name: "escalationRule", type: "string" },
  { name: "policyHash", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "predecessor", type: "bytes32" },
] as const;

export type MandateChoices = Omit<AgentMandate, "maxPerRequestText" | "maxPerPeriodText" | "maxLifetimeText" | "validUntilText"> & {
  verifyingContract: string;
  maxPerRequestText?: string;
  maxPerPeriodText?: string;
  maxLifetimeText?: string;
  validUntilText?: string;
};

export type AgentMandateTypedData = {
  domain: {
    name: typeof MANDATE_DOMAIN_NAME;
    version: typeof MANDATE_DOMAIN_VERSION;
    chainId: typeof MANDATE_CHAIN_ID;
    verifyingContract: `0x${string}`;
  };
  types: { AgentMandate: typeof agentMandateTypes };
  primaryType: "AgentMandate";
  message: AgentMandateTypedMessage;
};

export type AgentMandateTypedMessage = {
  agent: string;
  broker: `0x${string}`;
  spendAccount: string;
  allowedServices: string;
  allowedMethods: string;
  asset: string;
  maxPerRequest: bigint;
  maxPerRequestText: string;
  maxPerPeriod: bigint;
  maxPerPeriodText: string;
  periodSeconds: bigint;
  maxLifetime: bigint;
  maxLifetimeText: string;
  maxUnitsPerRequest: bigint;
  validFrom: bigint;
  validUntil: bigint;
  validUntilText: string;
  quoteMaxAgeSeconds: bigint;
  dataClass: number;
  escalationRule: string;
  policyHash: `0x${string}`;
  nonce: bigint;
  predecessor: `0x${string}`;
};

export type DeviceDisplayModel = {
  agent: string;
  services: string;
  methods: string;
  asset: string;
  maxPerRequest: string;
  maxPerPeriod: string;
  maxLifetime: string;
  validUntil: string;
  escalationRule: string;
};

export type CompiledMandate = {
  typedData: AgentMandateTypedData;
  canonicalMandate: AgentMandate;
  mandateId: Hash;
  deviceDisplayModel: DeviceDisplayModel;
};

function assertOptionalText(name: string, actual: string | undefined, expected: string): void {
  if (actual !== undefined && actual !== expected) {
    throw new Error(`${name} does not match the compiler display format`);
  }
}

function toTypedMessage(mandate: AgentMandate): AgentMandateTypedMessage {
  return {
    agent: mandate.agent,
    broker: mandate.broker as `0x${string}`,
    spendAccount: mandate.spendAccount,
    allowedServices: mandate.allowedServices,
    allowedMethods: mandate.allowedMethods,
    asset: mandate.asset,
    maxPerRequest: BigInt(mandate.maxPerRequest),
    maxPerRequestText: mandate.maxPerRequestText,
    maxPerPeriod: BigInt(mandate.maxPerPeriod),
    maxPerPeriodText: mandate.maxPerPeriodText,
    periodSeconds: BigInt(mandate.periodSeconds),
    maxLifetime: BigInt(mandate.maxLifetime),
    maxLifetimeText: mandate.maxLifetimeText,
    maxUnitsPerRequest: BigInt(mandate.maxUnitsPerRequest),
    validFrom: BigInt(mandate.validFrom),
    validUntil: BigInt(mandate.validUntil),
    validUntilText: mandate.validUntilText,
    quoteMaxAgeSeconds: BigInt(mandate.quoteMaxAgeSeconds),
    dataClass: mandate.dataClass,
    escalationRule: mandate.escalationRule,
    policyHash: mandate.policyHash as `0x${string}`,
    nonce: BigInt(mandate.nonce),
    predecessor: mandate.predecessor as `0x${string}`,
  };
}

export function compile(choices: MandateChoices): CompiledMandate {
  const parsedChoices = agentMandateSchema.omit({
    maxPerRequestText: true,
    maxPerPeriodText: true,
    maxLifetimeText: true,
    validUntilText: true,
  }).parse(choices);
  if (!/^0x[0-9a-fA-F]{40}$/.test(choices.verifyingContract)) {
    throw new Error("verifyingContract must be a 20-byte EVM address");
  }
  if (parsedChoices.allowedServices.split(",").filter(Boolean).length > 5) {
    throw new Error("v1 mandates allow at most five services");
  }

  const maxPerRequestText = formatDisplay(parsedChoices.maxPerRequest, parsedChoices.asset);
  const maxPerPeriodText = formatPeriodDisplay(parsedChoices.maxPerPeriod, parsedChoices.asset, parsedChoices.periodSeconds);
  const maxLifetimeText = `${formatDisplay(parsedChoices.maxLifetime, parsedChoices.asset)} total`;
  const validUntilText = formatUntilDisplay(parsedChoices.validUntil);
  assertOptionalText("maxPerRequestText", choices.maxPerRequestText, maxPerRequestText);
  assertOptionalText("maxPerPeriodText", choices.maxPerPeriodText, maxPerPeriodText);
  assertOptionalText("maxLifetimeText", choices.maxLifetimeText, maxLifetimeText);
  assertOptionalText("validUntilText", choices.validUntilText, validUntilText);

  const canonicalMandate: AgentMandate = {
    ...parsedChoices,
    maxPerRequestText,
    maxPerPeriodText,
    maxLifetimeText,
    validUntilText,
  };
  const typedData: AgentMandateTypedData = {
    domain: {
      name: MANDATE_DOMAIN_NAME,
      version: MANDATE_DOMAIN_VERSION,
      chainId: MANDATE_CHAIN_ID,
      verifyingContract: choices.verifyingContract as `0x${string}`,
    },
    types: { AgentMandate: agentMandateTypes },
    primaryType: "AgentMandate",
    message: toTypedMessage(canonicalMandate),
  };
  const mandateId = hashTypedData(typedData) as Hash;
  return {
    typedData,
    canonicalMandate,
    mandateId,
    deviceDisplayModel: {
      agent: canonicalMandate.agent,
      services: canonicalMandate.allowedServices,
      methods: canonicalMandate.allowedMethods,
      asset: canonicalMandate.asset,
      maxPerRequest: canonicalMandate.maxPerRequestText,
      maxPerPeriod: canonicalMandate.maxPerPeriodText,
      maxLifetime: canonicalMandate.maxLifetimeText,
      validUntil: canonicalMandate.validUntilText,
      escalationRule: canonicalMandate.escalationRule,
    },
  };
}

export * from "./revocation-amendment.js";
