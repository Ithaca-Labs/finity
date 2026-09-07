import { readTopicMessages, type MirrorFetcher, type RegistryClient } from "@finity/registry-client";
import type { DecisionReceipt, Hash, Quote, ServiceManifest, SignedAgentMandate } from "@finity/schemas";
import {
  checkBrokerSignature,
  checkHcsInclusion,
  checkManifestSignature,
  checkMandateSignature,
  checkPolicyHashCurrent,
  checkQuoteSignature,
  checkReceiptHashIntegrity,
  checkRegistryState,
  checkSettlementTransaction,
  type CheckResult,
} from "./checks.js";

export type VerifyInput = {
  receipt: DecisionReceipt;
  registryClient: Pick<RegistryClient, "readRecord">;
  verifyingContract: `0x${string}`;
  mandate?: SignedAgentMandate;
  manifest?: ServiceManifest;
  quote?: Quote;
  settlementTxId?: string;
  mirrorNodeUrl?: string;
  mirrorFetcher?: MirrorFetcher;
  fetchTransaction?: (txId: string, mirrorNodeUrl?: string) => Promise<{ result?: string } | undefined>;
};

export type VerifyResult = { verdict: "verified" | "invalid" | "insufficient_disclosure"; checks: CheckResult[] };

async function defaultFetchTransaction(txId: string, mirrorNodeUrl?: string): Promise<{ result?: string } | undefined> {
  const base = mirrorNodeUrl ?? "https://testnet.mirrornode.hedera.com";
  const response = await fetch(`${new URL(`/api/v1/transactions/${encodeURIComponent(txId)}`, base)}`);
  if (!response.ok) return undefined;
  const payload = (await response.json()) as { transactions?: { result?: string }[] };
  return payload.transactions?.[0];
}

/**
 * `finity-verify`: reconstructs a decision from public registry state, the
 * mandate's HCS trace, and whatever the caller discloses alongside the
 * receipt, per FINITY_BUILD_SPEC.md step 20. Only receipt + mandate ID are
 * required; each additional disclosure (--mandate-file, --manifest-file,
 * --quote-file, --settlement-tx) unlocks one more check. Checks that need a
 * disclosure the caller didn't provide report insufficient_disclosure rather
 * than being silently skipped or treated as failures.
 */
export async function verify(input: VerifyInput): Promise<VerifyResult> {
  const checks: CheckResult[] = [checkReceiptHashIntegrity(input.receipt), checkPolicyHashCurrent(input.receipt)];

  const record = await input.registryClient.readRecord(input.receipt.mandateId as Hash);
  checks.push(await checkBrokerSignature(input.receipt, record.broker));
  checks.push(checkRegistryState(input.receipt, record));

  if (input.mandate) {
    checks.push(await checkMandateSignature(input.mandate, input.verifyingContract, record.principal));
  } else {
    checks.push({ name: "mandateSignature", status: "insufficient_disclosure", detail: "no --mandate-file disclosed" });
  }

  if (input.manifest) {
    checks.push(await checkManifestSignature(input.manifest));
    if (input.quote) {
      checks.push(await checkQuoteSignature(input.quote, input.manifest));
    } else {
      checks.push({ name: "quoteSignature", status: "insufficient_disclosure", detail: "no --quote-file disclosed" });
    }
  } else {
    checks.push({ name: "manifestSignature", status: "insufficient_disclosure", detail: "no --manifest-file disclosed" });
    checks.push({ name: "quoteSignature", status: "insufficient_disclosure", detail: "no --manifest-file disclosed (quote signature check needs the provider's signingKey from the manifest)" });
  }

  if (record.traceTopic) {
    const messages = await readTopicMessages(record.traceTopic, { mirrorNodeUrl: input.mirrorNodeUrl, fetcher: input.mirrorFetcher });
    checks.push(checkHcsInclusion(input.receipt, record.traceTopic, messages));
  } else {
    checks.push({ name: "hcsInclusion", status: "insufficient_disclosure", detail: "mandate has no trace topic set on-chain yet" });
  }

  if (input.settlementTxId) {
    const fetchTransaction = input.fetchTransaction ?? defaultFetchTransaction;
    const transaction = await fetchTransaction(input.settlementTxId, input.mirrorNodeUrl);
    checks.push(checkSettlementTransaction(input.settlementTxId, transaction));
  } else {
    checks.push({ name: "settlementTx", status: "insufficient_disclosure", detail: "no --settlement-tx disclosed" });
  }

  const verdict: VerifyResult["verdict"] = checks.some((check) => check.status === "fail")
    ? "invalid"
    : checks.some((check) => check.status === "insufficient_disclosure")
      ? "insufficient_disclosure"
      : "verified";
  return { verdict, checks };
}
