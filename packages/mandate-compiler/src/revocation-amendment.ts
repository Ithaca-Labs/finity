import { mandateAmendmentSchema, revocationSchema, type MandateAmendment, type Revocation } from "@finity/schemas";
import { hashTypedData } from "viem";
import { MANDATE_CHAIN_ID, MANDATE_DOMAIN_NAME, MANDATE_DOMAIN_VERSION } from "./index.js";

const domainOf = (verifyingContract: `0x${string}`) =>
  ({
    name: MANDATE_DOMAIN_NAME,
    version: MANDATE_DOMAIN_VERSION,
    chainId: MANDATE_CHAIN_ID,
    verifyingContract,
  }) as const;

export const revocationTypes = [
  { name: "mandateId", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "reason", type: "string" },
] as const;

export type RevocationTypedMessage = { mandateId: `0x${string}`; nonce: bigint; reason: string };
export type RevocationTypedData = {
  domain: ReturnType<typeof domainOf>;
  types: { Revocation: typeof revocationTypes };
  primaryType: "Revocation";
  message: RevocationTypedMessage;
};
export type CompiledRevocation = { typedData: RevocationTypedData; canonicalRevocation: Revocation; digest: `0x${string}` };

/** Compiles a Revocation to the EIP-712 typed data the Principal signs on their Ledger, matching MandateRegistry.sol's REVOCATION_TYPEHASH exactly. */
export function compileRevocation(input: Revocation & { verifyingContract: `0x${string}` }): CompiledRevocation {
  const canonicalRevocation = revocationSchema.parse(input);
  const typedData: RevocationTypedData = {
    domain: domainOf(input.verifyingContract),
    types: { Revocation: revocationTypes },
    primaryType: "Revocation",
    message: { mandateId: canonicalRevocation.mandateId as `0x${string}`, nonce: BigInt(canonicalRevocation.nonce), reason: canonicalRevocation.reason },
  };
  return { typedData, canonicalRevocation, digest: hashTypedData(typedData) };
}

export const amendmentTypes = [
  { name: "mandateId", type: "bytes32" },
  { name: "field", type: "uint256" },
  { name: "newValue", type: "uint256" },
  { name: "newValueText", type: "string" },
  { name: "scopeServiceId", type: "string" },
  { name: "oneTime", type: "bool" },
  { name: "validUntil", type: "uint256" },
  { name: "nonce", type: "uint256" },
] as const;

export type MandateAmendmentTypedMessage = {
  mandateId: `0x${string}`;
  field: bigint;
  newValue: bigint;
  newValueText: string;
  scopeServiceId: string;
  oneTime: boolean;
  validUntil: bigint;
  nonce: bigint;
};
export type MandateAmendmentTypedData = {
  domain: ReturnType<typeof domainOf>;
  types: { MandateAmendment: typeof amendmentTypes };
  primaryType: "MandateAmendment";
  message: MandateAmendmentTypedMessage;
};
export type CompiledAmendment = { typedData: MandateAmendmentTypedData; canonicalAmendment: MandateAmendment; digest: `0x${string}` };

/** Compiles a MandateAmendment (an escalation approval) to EIP-712 typed data, matching MandateRegistry.sol's AMENDMENT_TYPEHASH exactly. */
export function compileAmendment(input: MandateAmendment & { verifyingContract: `0x${string}` }): CompiledAmendment {
  const canonicalAmendment = mandateAmendmentSchema.parse(input);
  const typedData: MandateAmendmentTypedData = {
    domain: domainOf(input.verifyingContract),
    types: { MandateAmendment: amendmentTypes },
    primaryType: "MandateAmendment",
    message: {
      mandateId: canonicalAmendment.mandateId as `0x${string}`,
      field: BigInt(canonicalAmendment.field),
      newValue: BigInt(canonicalAmendment.newValue),
      newValueText: canonicalAmendment.newValueText,
      scopeServiceId: canonicalAmendment.scopeServiceId,
      oneTime: canonicalAmendment.oneTime,
      validUntil: BigInt(canonicalAmendment.validUntil),
      nonce: BigInt(canonicalAmendment.nonce),
    },
  };
  return { typedData, canonicalAmendment, digest: hashTypedData(typedData) };
}
