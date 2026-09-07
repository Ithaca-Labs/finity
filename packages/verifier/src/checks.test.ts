import { describe, expect, it } from "vitest";
import { compile } from "@finity/mandate-compiler";
import { POLICY_HASH } from "@finity/policy-engine";
import { decisionReceiptCommitment } from "@finity/trace-builder";
import { canonicalizeJson, type DecisionReceipt, type Hash, type Quote, type ServiceManifest, type SignedAgentMandate } from "@finity/schemas";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
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
} from "./checks.js";

const brokerKey = generatePrivateKey();
const brokerAccount = privateKeyToAccount(brokerKey);
const providerKey = generatePrivateKey();
const providerAccount = privateKeyToAccount(providerKey);
const principalKey = generatePrivateKey();
const principalAccount = privateKeyToAccount(principalKey);

const verifyingContract = "0x2222222222222222222222222222222222222222" as const;

const decisionDraft: Omit<DecisionReceipt, "receiptId" | "brokerSignature"> = {
  kind: "finity.decision",
  correlationId: "00000000-0000-4000-8000-000000000001",
  mandateId: `0x${"01".repeat(32)}`,
  mandateVersion: "1",
  decision: "AUTHORIZED",
  reasonCodes: [],
  inputCommitment: `0x${"02".repeat(32)}`,
  policyHash: POLICY_HASH,
  quoteHash: `0x${"03".repeat(32)}`,
  manifestHash: `0x${"04".repeat(32)}`,
  evaluatedLimits: {
    perRequest: { limit: "5000000", requested: "5000000" },
    period: { limit: "500000000", requested: "5000000", consumed: "0" },
    lifetime: { limit: "2000000000", requested: "5000000", consumed: "0" },
  },
  at: 1_788_739_220,
  prevReceiptHash: `0x${"00".repeat(32)}`,
};

async function makeReceipt(overrides: Partial<typeof decisionDraft> = {}): Promise<DecisionReceipt> {
  const draft = { ...decisionDraft, ...overrides };
  const receiptId = decisionReceiptCommitment(draft) as Hash;
  const brokerSignature = await sign({ hash: receiptId, privateKey: brokerKey, to: "hex" });
  return { receiptId, ...draft, brokerSignature };
}

describe("checkReceiptHashIntegrity", () => {
  it("passes for an untampered receipt", async () => {
    const receipt = await makeReceipt();
    expect(checkReceiptHashIntegrity(receipt).status).toBe("pass");
  });

  it("fails when a field was changed after the receiptId was computed", async () => {
    const receipt = await makeReceipt();
    const tampered: DecisionReceipt = { ...receipt, reasonCodes: ["PRICE_LIMIT_EXCEEDED"] };
    expect(checkReceiptHashIntegrity(tampered).status).toBe("fail");
  });
});

describe("checkBrokerSignature", () => {
  it("passes when the signature recovers to the expected broker", async () => {
    const receipt = await makeReceipt();
    const result = await checkBrokerSignature(receipt, brokerAccount.address);
    expect(result.status).toBe("pass");
  });

  it("fails when the signature recovers to a different address", async () => {
    const receipt = await makeReceipt();
    const result = await checkBrokerSignature(receipt, "0x9999999999999999999999999999999999999999");
    expect(result.status).toBe("fail");
  });
});

describe("checkPolicyHashCurrent", () => {
  it("passes when the receipt's policyHash matches the live POLICY_HASH", async () => {
    const receipt = await makeReceipt();
    expect(checkPolicyHashCurrent(receipt).status).toBe("pass");
  });

  it("fails when the receipt was decided under a different policy version", async () => {
    const receipt = await makeReceipt({ policyHash: `0x${"ff".repeat(32)}` });
    expect(checkPolicyHashCurrent(receipt).status).toBe("fail");
  });
});

const mandateChoices = {
  agent: "did:aid:buyer", broker: brokerAccount.address, spendAccount: "0.0.123",
  allowedServices: "hello-weather@1", allowedMethods: "weather.current", asset: "HBAR" as const,
  maxPerRequest: "5000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000",
  maxUnitsPerRequest: "0", validFrom: 1_788_739_200, validUntil: 1_790_208_000, quoteMaxAgeSeconds: "120",
  dataClass: 0, escalationRule: "anything above per-request cap needs my Ledger", policyHash: POLICY_HASH,
  nonce: "1", predecessor: `0x${"00".repeat(32)}`, verifyingContract,
};

describe("checkMandateSignature", () => {
  it("passes when the mandate was really signed by the expected principal", async () => {
    const compiled = compile(mandateChoices);
    const signature = await principalAccount.signTypedData(compiled.typedData);
    const mandate: SignedAgentMandate = { ...compiled.canonicalMandate, signature, mandateId: compiled.mandateId };
    const result = await checkMandateSignature(mandate, verifyingContract, principalAccount.address);
    expect(result.status).toBe("pass");
  });

  it("fails when signed by someone other than the expected principal", async () => {
    const compiled = compile(mandateChoices);
    const signature = await brokerAccount.signTypedData(compiled.typedData);
    const mandate: SignedAgentMandate = { ...compiled.canonicalMandate, signature, mandateId: compiled.mandateId };
    const result = await checkMandateSignature(mandate, verifyingContract, principalAccount.address);
    expect(result.status).toBe("fail");
  });

  it("passes without an expected principal, just reporting the recovered signer", async () => {
    const compiled = compile(mandateChoices);
    const signature = await principalAccount.signTypedData(compiled.typedData);
    const mandate: SignedAgentMandate = { ...compiled.canonicalMandate, signature, mandateId: compiled.mandateId };
    const result = await checkMandateSignature(mandate, verifyingContract);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain(principalAccount.address);
  });
});

const unsignedManifest = {
  kind: "finity.manifest" as const, version: 1 as const, serviceId: "hello-weather@1",
  provider: { uaid: "did:aid:provider", hederaAccount: "0.0.789", signingKey: providerAccount.publicKey },
  name: "Hello Weather", description: "Current conditions.", baseUrl: "https://weather.example.test",
  methods: [{ id: "weather.current", inputSchemaRef: "in", outputSchemaRef: "out", dataClassMax: 0 }],
  pricing: { model: "fixed" as const, unit: "call" as const, asset: "0.0.0" as const, network: "hedera:testnet" as const },
  quoteEndpoint: "/quote", payTo: "0.0.789", receiptKey: providerAccount.publicKey, healthEndpoint: "/health",
  publishedAt: 1_788_739_200,
};

describe("checkManifestSignature", () => {
  it("passes for a manifest really signed by the provider's own key (EIP-191, ADR-006)", async () => {
    const signature = await providerAccount.signMessage({ message: canonicalizeJson(unsignedManifest) });
    const manifest: ServiceManifest = { ...unsignedManifest, signature };
    const result = await checkManifestSignature(manifest);
    expect(result.status).toBe("pass");
  });

  it("fails when the manifest was tampered with after signing", async () => {
    const signature = await providerAccount.signMessage({ message: canonicalizeJson(unsignedManifest) });
    const manifest: ServiceManifest = { ...unsignedManifest, name: "Tampered Weather", signature };
    const result = await checkManifestSignature(manifest);
    expect(result.status).toBe("fail");
  });
});

describe("checkQuoteSignature", () => {
  it("passes for a quote really signed by the provider's own key", async () => {
    const manifest: ServiceManifest = { ...unsignedManifest, signature: await providerAccount.signMessage({ message: canonicalizeJson(unsignedManifest) }) };
    const unsignedQuote = {
      kind: "finity.quote" as const, serviceId: "hello-weather@1", methodId: "weather.current",
      manifestHash: `0x${"04".repeat(32)}` as Hash, requestClass: { unit: "call" as const, units: "1" },
      amount: "5000000", asset: "0.0.0" as const, network: "hedera:testnet" as const, payTo: "0.0.789",
      nonce: "00000000-0000-4000-8000-000000000001", issuedAt: 100, expiresAt: 160,
    };
    const signature = await providerAccount.signMessage({ message: canonicalizeJson(unsignedQuote) });
    const quote: Quote = { ...unsignedQuote, signature };
    const result = await checkQuoteSignature(quote, manifest);
    expect(result.status).toBe("pass");
  });
});

describe("checkRegistryState", () => {
  it("passes and reports live state when the on-chain policyHash matches", async () => {
    const receipt = await makeReceipt();
    const result = checkRegistryState(receipt, {
      principal: principalAccount.address, broker: brokerAccount.address, policyHash: POLICY_HASH,
      limits: { maxPerRequest: "5000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000", validFrom: "0", validUntil: "0" },
      lifetimeConsumed: "0", periodIndex: "0", periodConsumed: "0", reserved: "0", status: 1,
      successor: `0x${"00".repeat(32)}`, traceTopic: "0.0.999",
    });
    expect(result.status).toBe("pass");
  });

  it("fails when the on-chain policyHash disagrees with the receipt's", async () => {
    const receipt = await makeReceipt();
    const result = checkRegistryState(receipt, {
      principal: principalAccount.address, broker: brokerAccount.address, policyHash: `0x${"ff".repeat(32)}`,
      limits: { maxPerRequest: "5000000", maxPerPeriod: "500000000", periodSeconds: "86400", maxLifetime: "2000000000", validFrom: "0", validUntil: "0" },
      lifetimeConsumed: "0", periodIndex: "0", periodConsumed: "0", reserved: "0", status: 1,
      successor: `0x${"00".repeat(32)}`, traceTopic: "0.0.999",
    });
    expect(result.status).toBe("fail");
  });
});

describe("checkHcsInclusion", () => {
  it("reports insufficient_disclosure when the mandate has no trace topic yet", async () => {
    const receipt = await makeReceipt();
    expect(checkHcsInclusion(receipt, "", []).status).toBe("insufficient_disclosure");
  });

  it("passes when a matching DECISION envelope is present", async () => {
    const receipt = await makeReceipt();
    const messages = [{ message: JSON.stringify({ t: "DECISION", h: receipt.receiptId }) }, { message: "not json" }];
    expect(checkHcsInclusion(receipt, "0.0.999", messages).status).toBe("pass");
  });

  it("fails when no matching envelope is present", async () => {
    const receipt = await makeReceipt();
    expect(checkHcsInclusion(receipt, "0.0.999", [{ message: JSON.stringify({ t: "DECISION", h: `0x${"ee".repeat(32)}` }) }]).status).toBe("fail");
  });
});

describe("checkSettlementTransaction", () => {
  it("passes for a SUCCESS result", () => {
    expect(checkSettlementTransaction("0.0.1@1.0", { result: "SUCCESS" }).status).toBe("pass");
  });

  it("fails for a non-SUCCESS result", () => {
    expect(checkSettlementTransaction("0.0.1@1.0", { result: "INVALID_SIGNATURE" }).status).toBe("fail");
  });

  it("fails when the mirror node has no transaction at all", () => {
    expect(checkSettlementTransaction("0.0.1@1.0", undefined).status).toBe("fail");
  });
});
