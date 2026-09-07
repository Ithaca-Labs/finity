import { compile, type MandateChoices } from "@finity/mandate-compiler";
import { POLICY_HASH } from "@finity/policy-engine";
import type { RegistryRecord } from "@finity/registry-client";
import {
  canonicalizeJson,
  type DecisionReceipt,
  type Hash,
  type ServiceManifest,
  type Quote,
  type SignedAgentMandate,
} from "@finity/schemas";
import { decisionReceiptCommitment } from "@finity/trace-builder";
import { hashMessage, recoverAddress, recoverPublicKey, recoverTypedDataAddress } from "viem";

export type CheckStatus = "pass" | "fail" | "insufficient_disclosure";
export type CheckResult = { name: string; status: CheckStatus; detail: string };

function pass(name: string, detail: string): CheckResult {
  return { name, status: "pass", detail };
}
function fail(name: string, detail: string): CheckResult {
  return { name, status: "fail", detail };
}
function insufficient(name: string, detail: string): CheckResult {
  return { name, status: "insufficient_disclosure", detail };
}

/** The receiptId is a commitment over the receipt's own content; recomputing it is how a receipt is checked for tampering, independent of any signature. */
export function checkReceiptHashIntegrity(receipt: DecisionReceipt): CheckResult {
  const { receiptId, brokerSignature: _brokerSignature, kind: _kind, ...draft } = receipt;
  const recomputed = decisionReceiptCommitment(draft);
  return recomputed === receiptId
    ? pass("receiptHashIntegrity", "receiptId matches the recomputed commitment over the receipt's own content")
    : fail("receiptHashIntegrity", `receiptId ${receiptId} does not match the recomputed commitment ${recomputed}`);
}

/** The receipt's brokerSignature is a raw secp256k1 signature over receiptId (no EIP-191/712 wrapping) - see @finity/finityd's createLiveDependencies signBrokerHash. */
export async function checkBrokerSignature(receipt: DecisionReceipt, expectedBroker: `0x${string}`): Promise<CheckResult> {
  let recovered: `0x${string}`;
  try {
    recovered = await recoverAddress({ hash: receipt.receiptId as Hash, signature: receipt.brokerSignature as Hash });
  } catch (error) {
    return fail("brokerSignature", `could not recover an address from brokerSignature: ${(error as Error).message}`);
  }
  return recovered.toLowerCase() === expectedBroker.toLowerCase()
    ? pass("brokerSignature", `brokerSignature recovers to the mandate's broker ${expectedBroker}`)
    : fail("brokerSignature", `brokerSignature recovers to ${recovered}, not the mandate's broker ${expectedBroker}`);
}

/** A receipt signed against a since-changed policy is not wrong, but it is not directly comparable to the live policy engine's behavior either. */
export function checkPolicyHashCurrent(receipt: DecisionReceipt): CheckResult {
  return receipt.policyHash === POLICY_HASH
    ? pass("policyHashCurrent", "receipt.policyHash matches the live @finity/policy-engine POLICY_HASH")
    : fail("policyHashCurrent", `receipt.policyHash ${receipt.policyHash} does not match the live POLICY_HASH ${POLICY_HASH}`);
}

/** Recompiles the disclosed mandate's EIP-712 typed data (deterministic from its own fields) and recovers the Ledger signer, per ADR mandate-compiler compile(). */
export async function checkMandateSignature(mandate: SignedAgentMandate, verifyingContract: `0x${string}`, expectedPrincipal?: `0x${string}`): Promise<CheckResult> {
  let typedData;
  try {
    typedData = compile({ ...mandate, verifyingContract } as MandateChoices & { verifyingContract: `0x${string}` }).typedData;
  } catch (error) {
    return fail("mandateSignature", `mandate failed to recompile: ${(error as Error).message}`);
  }
  let recovered: `0x${string}`;
  try {
    recovered = await recoverTypedDataAddress({ ...typedData, signature: mandate.signature as Hash });
  } catch (error) {
    return fail("mandateSignature", `could not recover a signer: ${(error as Error).message}`);
  }
  if (!expectedPrincipal) return pass("mandateSignature", `mandate signature recovers to ${recovered} (no expected principal supplied to compare against)`);
  return recovered.toLowerCase() === expectedPrincipal.toLowerCase()
    ? pass("mandateSignature", `mandate signature recovers to the expected principal ${expectedPrincipal}`)
    : fail("mandateSignature", `mandate signature recovers to ${recovered}, not the expected principal ${expectedPrincipal}`);
}

/** Providers sign manifests/quotes with EIP-191 personal-sign over the canonical JSON (ADR-006); the manifest records the signer's public key, not an address. */
async function checkEip191Signature(name: string, unsigned: unknown, signature: string, expectedPublicKey: string): Promise<CheckResult> {
  const hash = hashMessage(canonicalizeJson(unsigned));
  let recovered: `0x${string}`;
  try {
    recovered = await recoverPublicKey({ hash, signature: signature as Hash });
  } catch (error) {
    return fail(name, `could not recover a public key: ${(error as Error).message}`);
  }
  return recovered === expectedPublicKey
    ? pass(name, "signature recovers to the provider's declared signingKey")
    : fail(name, `signature recovers to a different public key than provider.signingKey`);
}

export function checkManifestSignature(manifest: ServiceManifest): Promise<CheckResult> {
  const { signature, ...unsigned } = manifest;
  return checkEip191Signature("manifestSignature", unsigned, signature, manifest.provider.signingKey);
}

/** Assumes the same provider key signs manifests and quotes (ADR-006 covers "manifests, quotes, and usage receipts" together); this has not been independently confirmed for quotes. */
export function checkQuoteSignature(quote: Quote, manifest: ServiceManifest): Promise<CheckResult> {
  const { signature, ...unsigned } = quote;
  return checkEip191Signature("quoteSignature", unsigned, signature, manifest.provider.signingKey);
}

/** On-chain consumption is a moving target; this reports the live state for the auditor to compare against the receipt's evaluatedLimits rather than asserting a stale equality. */
export function checkRegistryState(receipt: DecisionReceipt, record: RegistryRecord): CheckResult {
  if (record.policyHash.toLowerCase() !== receipt.policyHash.toLowerCase()) {
    return fail("registryState", `on-chain policyHash ${record.policyHash} does not match the receipt's ${receipt.policyHash}`);
  }
  return pass(
    "registryState",
    `mandate is on-chain with status ${record.status}; current limits.maxPerRequest=${record.limits.maxPerRequest} vs receipt's evaluatedLimits.perRequest.limit=${receipt.evaluatedLimits.perRequest.limit} (may legitimately differ if amended since)`,
  );
}

export type MirrorTopicMessage = { message: string };

/** Confirms the receipt's own commitment is actually present as a DECISION envelope on the mandate's trace topic, not merely claimed. */
export function checkHcsInclusion(receipt: DecisionReceipt, traceTopic: string, messages: MirrorTopicMessage[]): CheckResult {
  if (!traceTopic) return insufficient("hcsInclusion", "mandate has no trace topic set on-chain yet");
  const found = messages.some((entry) => {
    try {
      const envelope = JSON.parse(entry.message) as { t?: string; h?: string };
      return envelope.t === "DECISION" && envelope.h === receipt.receiptId;
    } catch {
      return false;
    }
  });
  return found
    ? pass("hcsInclusion", `a DECISION envelope matching receiptId ${receipt.receiptId} was found on trace topic ${traceTopic}`)
    : fail("hcsInclusion", `no DECISION envelope matching receiptId ${receipt.receiptId} was found on trace topic ${traceTopic}`);
}

export type MirrorTransaction = { result?: string };

export function checkSettlementTransaction(txId: string, transaction: MirrorTransaction | undefined): CheckResult {
  if (!transaction) return fail("settlementTx", `mirror node returned no transaction for ${txId}`);
  return transaction.result === "SUCCESS"
    ? pass("settlementTx", `transaction ${txId} settled successfully`)
    : fail("settlementTx", `transaction ${txId} result was ${transaction.result ?? "unknown"}, not SUCCESS`);
}
