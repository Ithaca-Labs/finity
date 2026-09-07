import { compile, type CompiledMandate, type MandateChoices } from "@finity/mandate-compiler";
import type { RegistryClient } from "@finity/registry-client";
import type { Hash, SignedAgentMandate } from "@finity/schemas";

export type MandateSigner = (typedData: CompiledMandate["typedData"]) => Promise<`0x${string}`>;
export type TraceTopicCreator = (memo: string) => Promise<{ topicId: string; transactionId: string }>;

export type RegisterMandateInput = {
  choices: MandateChoices;
  registryClient: Pick<RegistryClient, "registerMandate" | "setTraceTopic">;
  sign: MandateSigner;
  createTraceTopic: TraceTopicCreator;
};

export type RegisteredMandate = {
  mandateId: Hash;
  signedMandate: SignedAgentMandate;
  deviceDisplayModel: CompiledMandate["deviceDisplayModel"];
  registrationTx: Hash;
  traceTopicId: string;
  traceTopicTx: string;
  setTraceTopicTx: Hash;
};

/**
 * `/finity mandate new`: compile the choices to EIP-712 typed data, have the
 * Principal sign it (on a real run, via signTypedDataOnDevice), register the
 * signed mandate on-chain, create its HCS trace topic, and bind the two
 * together. Each on-chain step only runs after the previous one succeeds -
 * a declined device signature or a reverted registration never leaves a
 * trace topic dangling with no registered mandate behind it.
 */
export async function registerMandateOnChain(input: RegisterMandateInput): Promise<RegisteredMandate> {
  const compiled = compile(input.choices);
  const signature = await input.sign(compiled.typedData);
  const registrationTx = await input.registryClient.registerMandate(compiled.canonicalMandate, signature);
  const topic = await input.createTraceTopic(`Finity mandate trace ${compiled.mandateId}`);
  const setTraceTopicTx = await input.registryClient.setTraceTopic(compiled.mandateId, topic.topicId);
  return {
    mandateId: compiled.mandateId,
    signedMandate: { ...compiled.canonicalMandate, signature, mandateId: compiled.mandateId },
    deviceDisplayModel: compiled.deviceDisplayModel,
    registrationTx,
    traceTopicId: topic.topicId,
    traceTopicTx: topic.transactionId,
    setTraceTopicTx,
  };
}
