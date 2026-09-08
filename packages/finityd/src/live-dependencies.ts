import { createHcsWriter, createRegistryClient, mandateRegistryAbi, type RegistryClient } from "@finity/registry-client";
import { POLICY_HASH } from "@finity/policy-engine";
import type { ServiceManifest, SignedAgentMandate } from "@finity/schemas";
import { decodeEventLog, type Hash } from "viem";
import { sign } from "viem/accounts";
import type { PaymentRequirementsSubset } from "@finity/commerce-adapter";
import type { MandateStore, PurchaseDependencies } from "./executor.js";

export type LiveDependenciesConfig = {
  mandateStore: MandateStore;
  registryAddress: string;
  registryTopicId: string;
  rpcUrl?: string;
  mirrorNodeUrl?: string;
  brokerAddress: `0x${string}`;
  brokerEvmPrivateKey: `0x${string}`;
  spendAccountId: string;
  brokerSessionKey: string;
  hederaOperatorId: string;
  hederaOperatorKey: string;
  /**
   * ServiceManifest has no client-facing resource path for a paid method
   * (only quoteEndpoint/healthEndpoint), so the caller must supply one.
   * Defaults to a small map covering the two known Day 2 demo services.
   */
  resourceUrl?: (manifest: ServiceManifest, methodId: string) => string;
};

const DEMO_RESOURCE_PATHS: Record<string, string> = {
  "hello-weather@1:weather.current": "/weather?city=Kolkata",
  "summarize-lite@1:summarize.text": "/summarize",
};

function defaultResourceUrl(manifest: ServiceManifest, methodId: string): string {
  const path = DEMO_RESOURCE_PATHS[`${manifest.serviceId}:${methodId}`];
  if (!path) throw new Error(`no known resource path for ${manifest.serviceId}:${methodId}`);
  return `${manifest.baseUrl}${path}`;
}

/** Reads x402 v2's base64 PAYMENT-REQUIRED header, with legacy body support. */
export async function parsePaymentChallenges(response: Response): Promise<PaymentRequirementsSubset[]> {
  const encoded = response.headers.get("PAYMENT-REQUIRED");
  if (encoded) {
    try {
      const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as { accepts?: unknown };
      if (Array.isArray(decoded.accepts)) return decoded.accepts as PaymentRequirementsSubset[];
    } catch {
      throw new Error("402 PAYMENT-REQUIRED header is invalid");
    }
    throw new Error("402 PAYMENT-REQUIRED header has no accepts array");
  }
  const body = (await response.clone().json()) as { accepts?: unknown };
  if (!Array.isArray(body.accepts)) throw new Error("402 response did not include payment requirements");
  return body.accepts as PaymentRequirementsSubset[];
}

/**
 * Builds the real, on-chain/on-network PurchaseDependencies bundle:
 * a live MandateRegistry client, on-chain reservation with the actual
 * reservationId recovered from ReservationCreated (RegistryClient.reserve()
 * only returns the write's transaction hash), raw ECDSA signing with the
 * Broker Session Key, and HCS trace submission when a mandate has a trace
 * topic set. Shared by the gated CLI script and the finityd daemon so the
 * two don't drift.
 *
 * Real signature verification for the mandate/quote/manifest is not yet
 * decided anywhere in this codebase (that's @finity/verifier's job), so the
 * snapshot builder trusts them unconditionally rather than inventing a
 * scheme - callers relying on this for anything but local/gated-testnet use
 * should know that gap exists.
 */
export type LiveDependencies = PurchaseDependencies & {
  registerMandate(mandate: SignedAgentMandate): Promise<Record<string, unknown>>;
};

export function createLiveDependencies(config: LiveDependenciesConfig): LiveDependencies {
  const registryClient: RegistryClient = createRegistryClient({
    contractAddress: config.registryAddress,
    rpcUrl: config.rpcUrl,
    privateKey: config.brokerEvmPrivateKey,
  });

  async function reserveOnChain(mandateId: Hash, amountTinybar: string): Promise<Hash> {
    const txHash = await registryClient.reserve(mandateId, amountTinybar);
    const receipt = await registryClient.publicClient.waitForTransactionReceipt({ hash: txHash });
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: mandateRegistryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "ReservationCreated") return (decoded.args as { reservationId: Hash }).reservationId;
      } catch {
        continue;
      }
    }
    throw new Error("reserve() did not emit a ReservationCreated event");
  }

  const signBrokerHash = async (commitment: Hash): Promise<`0x${string}`> =>
    sign({ hash: commitment, privateKey: config.brokerEvmPrivateKey, to: "hex" });

  const resourceUrl = config.resourceUrl ?? defaultResourceUrl;
  let hcsWriter: ReturnType<typeof createHcsWriter> | undefined;
  function getHcsWriter() {
    hcsWriter ??= createHcsWriter({ network: "hedera:testnet", operatorId: config.hederaOperatorId, privateKey: config.hederaOperatorKey });
    return hcsWriter;
  }

  return {
    mandateStore: config.mandateStore,
    now: () => Math.floor(Date.now() / 1000),
    topicId: config.registryTopicId,
    mirrorNodeUrl: config.mirrorNodeUrl,
    registryRecord: (id) => registryClient.readRecord(id),
    reserve: reserveOnChain,
    finalize: async (reservationId, actual) => {
      await registryClient.publicClient.waitForTransactionReceipt({ hash: await registryClient.finalize(reservationId, actual) });
    },
    release: async (reservationId) => {
      await registryClient.publicClient.waitForTransactionReceipt({ hash: await registryClient.release(reservationId) });
    },
    buildSnapshot: (input) => {
      const { signature: _signature, mandateId: _mandateId, ...agentMandate } = input.mandate;
      const statusByCode = ["NONE", "ACTIVE", "EXHAUSTED", "EXPIRED", "REVOKED", "SUPERSEDED"] as const;
      return {
        mandate: agentMandate,
        mandateStatus: statusByCode[input.registryRecord.status] ?? "NONE",
        mandateSuperseded: input.registryRecord.successor !== `0x${"00".repeat(32)}`,
        principal: input.registryRecord.principal,
        signatureValid: true,
        displayValid: true,
        agentUaid: input.mandate.agent,
        brokerAddress: input.mandate.broker,
        providerAllowed: true,
        providerAccount: input.manifest.provider.hederaAccount,
        serviceId: input.manifest.serviceId,
        methodId: input.quote.methodId,
        quote: input.quote,
        manifest: input.manifest,
        manifestSignatureValid: true,
        quoteSignatureValid: true,
        quoteNonceReused: false,
        requestDataClass: input.requestDataClass,
        policyHash: POLICY_HASH,
        currentPeriodConsumed: input.registryRecord.periodConsumed,
        currentLifetimeConsumed: input.registryRecord.lifetimeConsumed,
        now: input.now,
        revocationActive: false,
      };
    },
    signCapability: signBrokerHash,
    signReceipt: signBrokerHash,
    resourceUrl,
    spendAccountId: config.spendAccountId,
    brokerSessionKey: config.brokerSessionKey,
    brokerAddress: config.brokerAddress,
    parseChallenges: parsePaymentChallenges,
    submitTrace: async (envelope) => {
      const record = await registryClient.readRecord(envelope.m as Hash);
      if (!record.traceTopic) return undefined;
      return getHcsWriter().submitMessage(record.traceTopic, envelope);
    },
    registerMandate: async (signedMandate) => {
      const { signature, mandateId, ...mandate } = signedMandate;
      const registrationTx = await registryClient.registerMandate(mandate, signature);
      await registryClient.publicClient.waitForTransactionReceipt({ hash: registrationTx });
      if ((await registryClient.readStatus(mandateId as Hash)) !== 1) {
        throw new Error("registered mandate ID does not match its signed EIP-712 digest");
      }
      const topic = await getHcsWriter().createTopic(`Finity mandate trace ${mandateId}`);
      const setTraceTopicTx = await registryClient.setTraceTopic(mandateId as Hash, topic.topicId);
      await registryClient.publicClient.waitForTransactionReceipt({ hash: setTraceTopicTx });
      config.mandateStore.set(mandateId as Hash, signedMandate);
      return { mandateId, registrationTx, traceTopicId: topic.topicId, traceTopicTx: topic.transactionId, setTraceTopicTx };
    },
  };
}
