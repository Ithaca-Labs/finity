import { describe, expect, it } from "vitest";
import { compile } from "@finity/mandate-compiler";
import { POLICY_HASH } from "@finity/policy-engine";
import type { RegistryRecord } from "@finity/registry-client";
import { canonicalizeJson, type DecisionReceipt, type Hash, type Quote, type ServiceManifest, type SignedAgentMandate } from "@finity/schemas";
import { decisionReceiptCommitment } from "@finity/trace-builder";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { verify } from "./verify.js";

const brokerKey = generatePrivateKey();
const brokerAccount = privateKeyToAccount(brokerKey);
const principalKey = generatePrivateKey();
const principalAccount = privateKeyToAccount(principalKey);
const providerKey = generatePrivateKey();
const providerAccount = privateKeyToAccount(providerKey);
const verifyingContract = "0x2222222222222222222222222222222222222222" as const;

const mandateChoices = {
  agent: "did:aid:buyer", broker: brokerAccount.address, spendAccount: "0.0.123",
  allowedServices: "hello-weather@1", allowedMethods: "weather.current", asset: "HBAR" as const,
  maxPerRequest: "5000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000",
  maxUnitsPerRequest: "0", validFrom: 1_788_739_200, validUntil: 1_790_208_000, quoteMaxAgeSeconds: "120",
  dataClass: 0, escalationRule: "anything above per-request cap needs my Ledger", policyHash: POLICY_HASH,
  nonce: "1", predecessor: `0x${"00".repeat(32)}`, verifyingContract,
};
const compiledMandate = compile(mandateChoices);

async function makeMandate(): Promise<SignedAgentMandate> {
  const signature = await principalAccount.signTypedData(compiledMandate.typedData);
  return { ...compiledMandate.canonicalMandate, signature, mandateId: compiledMandate.mandateId };
}

const unsignedManifest = {
  kind: "finity.manifest" as const, version: 1 as const, serviceId: "hello-weather@1",
  provider: { uaid: "did:aid:provider", hederaAccount: "0.0.789", signingKey: providerAccount.publicKey },
  name: "Hello Weather", description: "Current conditions.", baseUrl: "https://weather.example.test",
  methods: [{ id: "weather.current", inputSchemaRef: "in", outputSchemaRef: "out", dataClassMax: 0 }],
  pricing: { model: "fixed" as const, unit: "call" as const, asset: "0.0.0" as const, network: "hedera:testnet" as const },
  quoteEndpoint: "/quote", payTo: "0.0.789", receiptKey: providerAccount.publicKey, healthEndpoint: "/health",
  publishedAt: 1_788_739_200,
};

async function makeManifest(): Promise<ServiceManifest> {
  return { ...unsignedManifest, signature: await providerAccount.signMessage({ message: canonicalizeJson(unsignedManifest) }) };
}

async function makeQuote(): Promise<Quote> {
  const unsignedQuote = {
    kind: "finity.quote" as const, serviceId: "hello-weather@1", methodId: "weather.current",
    manifestHash: `0x${"04".repeat(32)}` as Hash, requestClass: { unit: "call" as const, units: "1" },
    amount: "5000000", asset: "0.0.0" as const, network: "hedera:testnet" as const, payTo: "0.0.789",
    nonce: "00000000-0000-4000-8000-000000000001", issuedAt: 100, expiresAt: 160,
  };
  return { ...unsignedQuote, signature: await providerAccount.signMessage({ message: canonicalizeJson(unsignedQuote) }) };
}

async function makeReceipt(): Promise<DecisionReceipt> {
  const draft = {
    kind: "finity.decision" as const,
    correlationId: "00000000-0000-4000-8000-000000000001",
    mandateId: compiledMandate.mandateId,
    mandateVersion: "1",
    decision: "AUTHORIZED" as const,
    reasonCodes: [] as string[],
    inputCommitment: `0x${"02".repeat(32)}` as Hash,
    policyHash: POLICY_HASH,
    quoteHash: `0x${"03".repeat(32)}` as Hash,
    manifestHash: `0x${"04".repeat(32)}` as Hash,
    evaluatedLimits: {
      perRequest: { limit: "5000000", requested: "5000000" },
      period: { limit: "500000000", requested: "5000000", consumed: "0" },
      lifetime: { limit: "2000000000", requested: "5000000", consumed: "0" },
    },
    at: 1_788_739_220,
    prevReceiptHash: `0x${"00".repeat(32)}` as Hash,
  };
  const receiptId = decisionReceiptCommitment(draft) as Hash;
  const brokerSignature = await sign({ hash: receiptId, privateKey: brokerKey, to: "hex" });
  return { receiptId, ...draft, brokerSignature };
}

const activeRecord = (traceTopic: string): RegistryRecord => ({
  principal: principalAccount.address, broker: brokerAccount.address, policyHash: POLICY_HASH,
  limits: { maxPerRequest: "5000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000", validFrom: "0", validUntil: "0" },
  lifetimeConsumed: "0", periodIndex: "0", periodConsumed: "0", reserved: "0", status: 1,
  successor: `0x${"00".repeat(32)}`, traceTopic,
});

describe("verify", () => {
  it("reports insufficient_disclosure with only the receipt and mandate ID (no optional disclosures)", async () => {
    const receipt = await makeReceipt();
    const result = await verify({
      receipt, verifyingContract,
      registryClient: { readRecord: async () => activeRecord("") },
    });
    expect(result.verdict).toBe("insufficient_disclosure");
    expect(result.checks.find((check) => check.name === "receiptHashIntegrity")?.status).toBe("pass");
    expect(result.checks.find((check) => check.name === "brokerSignature")?.status).toBe("pass");
    expect(result.checks.filter((check) => check.status === "insufficient_disclosure").map((check) => check.name)).toEqual(
      expect.arrayContaining(["mandateSignature", "manifestSignature", "quoteSignature", "hcsInclusion", "settlementTx"]),
    );
  });

  it("reports verified when every disclosure checks out", async () => {
    const receipt = await makeReceipt();
    const mandate = await makeMandate();
    const manifest = await makeManifest();
    const quote = await makeQuote();
    const decisionEnvelope = { message: JSON.stringify({ t: "DECISION", h: receipt.receiptId }) };
    const result = await verify({
      receipt, verifyingContract, mandate, manifest, quote, settlementTxId: "0.0.1@1.0",
      registryClient: { readRecord: async () => activeRecord("0.0.999") },
      mirrorFetcher: (async () => new Response(JSON.stringify({ messages: [{ message: Buffer.from(decisionEnvelope.message).toString("base64"), sequence_number: 0 }], links: { next: null } }), { status: 200 })) as typeof fetch,
      fetchTransaction: async () => ({ result: "SUCCESS" }),
    });
    expect(result.verdict).toBe("verified");
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("reports invalid when any check fails, even if others pass", async () => {
    const receipt = await makeReceipt();
    const result = await verify({
      receipt, verifyingContract,
      registryClient: { readRecord: async () => activeRecord("") },
      mandate: { ...(await makeMandate()), signature: `0x${"00".repeat(65)}` },
    });
    expect(result.verdict).toBe("invalid");
    expect(result.checks.find((check) => check.name === "mandateSignature")?.status).toBe("fail");
  });

  it("prioritizes invalid over insufficient_disclosure when both are present", async () => {
    const receipt = await makeReceipt();
    const result = await verify({
      receipt, verifyingContract,
      registryClient: { readRecord: async () => activeRecord("") }, // no manifest/quote/settlement disclosed -> insufficient
      mandate: { ...(await makeMandate()), signature: `0x${"00".repeat(65)}` }, // but this one fails
    });
    expect(result.verdict).toBe("invalid");
  });
});
