import { randomUUID } from "node:crypto";
import { createHcsWriter, createRegistryClient, hederaTestnetChain, mandateRegistryAbi, type RegistryClient } from "@finity/registry-client";
import { POLICY_HASH } from "@finity/policy-engine";
import { hashCanonicalJson, type Revocation, type ServiceManifest, type SignedAgentMandate } from "@finity/schemas";
import { buildEnvelope } from "@finity/trace-builder";
import { createWalletClient, decodeEventLog, http, type Address, type Hash } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { settlementTransaction, type PaymentRequirementsSubset } from "@finity/commerce-adapter";
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

const EVM_WEI_PER_TINYBAR = 10_000_000_000n;

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
  revokeMandate(revocation: Revocation, signature: `0x${string}`): Promise<Record<string, unknown>>;
  brokerAccount: {
    address: `0x${string}`;
    spendAccountId: string;
    getBalanceTinybar(): Promise<string>;
    withdrawToPrincipal(input: { destination: `0x${string}`; amountTinybar: string }): Promise<{
      transactionHash: string;
      destination: `0x${string}`;
      amountTinybar: string;
      feeTinybar: string;
    }>;
  };
};

export function createLiveDependencies(config: LiveDependenciesConfig): LiveDependencies {
  const registryClient: RegistryClient = createRegistryClient({
    contractAddress: config.registryAddress,
    rpcUrl: config.rpcUrl,
    privateKey: config.brokerEvmPrivateKey,
  });
  const brokerAccount = privateKeyToAccount(config.brokerEvmPrivateKey);
  if (brokerAccount.address.toLowerCase() !== config.brokerAddress.toLowerCase()) {
    throw new Error("configured broker address does not match the Broker Session Key");
  }
  const brokerWallet = createWalletClient({
    account: brokerAccount,
    chain: hederaTestnetChain,
    transport: http(config.rpcUrl),
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

  const brokerRuntime = {
    address: config.brokerAddress,
    spendAccountId: config.spendAccountId,
    async getBalanceTinybar(): Promise<string> {
      const balance = await registryClient.publicClient.getBalance({ address: config.brokerAddress });
      return (balance / EVM_WEI_PER_TINYBAR).toString();
    },
    async withdrawToPrincipal(input: { destination: `0x${string}`; amountTinybar: string }) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(input.destination)) throw new Error("withdrawal destination must be an EVM address");
      if (!/^[1-9][0-9]*$/.test(input.amountTinybar)) throw new Error("withdrawal amount must be a positive integer string");
      const value = BigInt(input.amountTinybar) * EVM_WEI_PER_TINYBAR;
      const [balance, gasPrice, gas] = await Promise.all([
        registryClient.publicClient.getBalance({ address: config.brokerAddress }),
        registryClient.publicClient.getGasPrice(),
        registryClient.publicClient.estimateGas({ account: config.brokerAddress, to: input.destination, value }),
      ]);
      const fee = gas * gasPrice;
      if (balance < value + fee) throw new Error("broker balance is too low for the requested withdrawal plus network fee");
      const transactionHash = await brokerWallet.sendTransaction({
        account: brokerAccount,
        chain: hederaTestnetChain,
        to: input.destination as Address,
        value,
        gas,
        gasPrice,
      });
      const receipt = await registryClient.publicClient.waitForTransactionReceipt({ hash: transactionHash });
      if (receipt.status !== "success") throw new Error(`withdrawal transaction ${transactionHash} reverted`);
      return {
        transactionHash,
        destination: input.destination,
        amountTinybar: input.amountTinybar,
        feeTinybar: (fee / EVM_WEI_PER_TINYBAR).toString(),
      };
    },
  };

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
    brokerAccount: brokerRuntime,
    parseChallenges: parsePaymentChallenges,
    paymentTransaction: settlementTransaction,
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
    revokeMandate: async (revocation, signature) => {
      const mandateId = revocation.mandateId as Hash;
      const revocationTx = await registryClient.revoke(
        { ...revocation, mandateId },
        signature,
      );
      await registryClient.publicClient.waitForTransactionReceipt({ hash: revocationTx });
      const registryRecord = await registryClient.readRecord(mandateId);
      if (registryRecord.status !== 4) throw new Error("mandate revocation was not reflected on-chain");

      let traceStatus: "SUBMITTED" | "FAILED" | "NOT_CONFIGURED" = "NOT_CONFIGURED";
      let traceTransactionId: string | undefined;
      if (registryRecord.traceTopic) {
        const mandateRecord = config.mandateStore.get(mandateId);
        if (mandateRecord) {
          try {
            const envelope = buildEnvelope({
              type: "REVOKED",
              correlationId: randomUUID(),
              receiptHash: hashCanonicalJson({ kind: "finity.revocation", revocation, signature }),
              previousReceiptHash: mandateRecord.lastReceiptHash,
              mandateId,
              transactionId: revocationTx,
            });
            traceTransactionId = await getHcsWriter().submitMessage(registryRecord.traceTopic, envelope);
            config.mandateStore.recordReceiptHash(mandateId, envelope.h as Hash);
            traceStatus = "SUBMITTED";
          } catch {
            // Revocation is already final on-chain. Report partial trace failure
            // instead of presenting the irreversible action as wholly failed.
            traceStatus = "FAILED";
          }
        } else {
          traceStatus = "FAILED";
        }
      }
      return {
        mandateId,
        revocationTx,
        status: "REVOKED",
        traceStatus,
        ...(traceTransactionId ? { traceTransactionId } : {}),
      };
    },
  };
}
