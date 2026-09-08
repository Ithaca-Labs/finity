import { createHcsWriter } from "@finity/registry-client";
import { hashCanonicalJson } from "@finity/schemas";
import { helloWeatherManifest } from "@finity/hello-weather";
import { summarizeLiteManifest } from "@finity/summarize-lite";
import { loadProviderRuntime } from "./provider-runtime.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.env.FINITY_TESTNET !== "1") {
  throw new Error("refusing HCS writes: set FINITY_TESTNET=1 after explicitly funding the operator account");
}

const weather = await loadProviderRuntime("A", helloWeatherManifest);
const summarize = await loadProviderRuntime("B", summarizeLiteManifest);
const writer = createHcsWriter({
  network: "hedera:testnet",
  operatorId: required("HEDERA_OPERATOR_ID"),
  privateKey: required("HEDERA_OPERATOR_KEY"),
});

try {
  const topic = process.env.FINITY_REGISTRY_TOPIC_ID
    ? { topicId: process.env.FINITY_REGISTRY_TOPIC_ID, transactionId: "" }
    : await writer.createTopic("Finity Service Registry v1");
  const publish = async (manifest: typeof weather.manifest) => {
    return {
      serviceId: manifest.serviceId,
      manifestHash: hashCanonicalJson(manifest),
      transactionId: await writer.submitServiceManifest(topic.topicId, manifest),
    };
  };
  const messages = [await publish(weather.manifest), await publish(summarize.manifest)];
  console.log(JSON.stringify({ topic, messages }, null, 2));
} finally {
  writer.close();
}
