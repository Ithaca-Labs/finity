import { compileAmendment, type CompiledAmendment } from "@finity/mandate-compiler";
import type { RegistryClient } from "@finity/registry-client";
import type { Hash, SignedAgentMandate } from "@finity/schemas";
import { encodeAbiParameters, keccak256 } from "viem";

export type ProposedAmendment = {
  field: number;
  newValue: string;
  newValueText: string;
  scopeServiceId: string;
  oneTime: boolean;
  validUntil: number;
  nonce: string;
};

export type AmendmentSigner = (typedData: CompiledAmendment["typedData"]) => Promise<`0x${string}`>;

export type ApproveEscalationInput = {
  mandateId: `0x${string}`;
  predecessorMandate: SignedAgentMandate;
  proposedAmendment: ProposedAmendment;
  registryClient: Pick<RegistryClient, "amend">;
  sign: AmendmentSigner;
  verifyingContract: `0x${string}`;
};

export type ApprovedEscalation = {
  successorMandateId: Hash;
  amendTx: Hash;
  successorMandate: SignedAgentMandate;
};

/** Matches MandateRegistry.sol's `successorId = keccak256(abi.encode(amendment.mandateId, amendmentDigest))` exactly. */
function computeSuccessorId(mandateId: Hash, amendmentDigest: Hash): Hash {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [mandateId, amendmentDigest]));
}

/**
 * `/finity escalations approve <id>`: signs the Principal's approval of a
 * one-time cap increase (a MandateAmendment) and registers it on-chain.
 *
 * policy-engine's ProposedAmendment echoes the original mandate's own
 * registration nonce in its `nonce` field, which the contract already
 * marked used when that mandate was registered - signing with it as-is
 * would revert with NonceAlreadyUsed. A fresh nonce is generated here
 * instead, the same pragmatic choice already made for /finity revoke.
 */
export async function approveEscalation(input: ApproveEscalationInput): Promise<ApprovedEscalation> {
  const nonce = String(Date.now());
  const { typedData, canonicalAmendment, digest } = compileAmendment({
    mandateId: input.mandateId,
    field: input.proposedAmendment.field,
    newValue: input.proposedAmendment.newValue,
    newValueText: input.proposedAmendment.newValueText,
    scopeServiceId: input.proposedAmendment.scopeServiceId,
    oneTime: input.proposedAmendment.oneTime,
    validUntil: input.proposedAmendment.validUntil,
    nonce,
    verifyingContract: input.verifyingContract,
  });
  const signature = await input.sign(typedData);
  const amendTx = await input.registryClient.amend({ ...canonicalAmendment, mandateId: canonicalAmendment.mandateId as Hash }, signature);
  const successorMandateId = computeSuccessorId(input.mandateId, digest);

  // The chain's successor Record is created directly from the amendment, with
  // no separate full-AgentMandate signature. This reconstructs the successor's
  // off-chain text for finityd's MandateStore by applying the same field-0
  // (maxPerRequest) change the contract applies; `signature` carries the
  // amendment's signature as a provenance pointer, not a valid AgentMandate
  // signature over this content - nothing should verify it as one.
  const successorMandate: SignedAgentMandate = {
    ...input.predecessorMandate,
    maxPerRequest: canonicalAmendment.newValue,
    maxPerRequestText: canonicalAmendment.newValueText,
    validUntil: canonicalAmendment.validUntil,
    nonce: canonicalAmendment.nonce,
    predecessor: input.mandateId,
    signature,
    mandateId: successorMandateId,
  };

  return { successorMandateId, amendTx, successorMandate };
}
