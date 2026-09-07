import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { PrivateKey, createClientHederaSigner } from "@x402/hedera";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function serviceOrigin(name: string): string {
  const url = new URL(required(name));
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin without credentials, path, query, or fragment`);
  }
  return url.origin;
}

if (process.env.FINITY_TESTNET !== "1") {
  throw new Error("refusing to spend HBAR: set FINITY_TESTNET=1 after reviewing the configured service URLs and account");
}

const signer = createClientHederaSigner(
  required("FINITY_SPEND_ACCOUNT_ID"),
  PrivateKey.fromString(required("FINITY_BROKER_SESSION_KEY")),
  { network: "hedera:testnet" },
);
const client = new x402Client().register("hedera:testnet", new ExactHederaScheme(signer));
const paidFetch = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

async function purchase(label: string, url: string, init?: RequestInit): Promise<void> {
  const response = await paidFetch(url, init);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const payment = await httpClient.processResponse(response.clone());
  if (payment.paymentStatus !== "settled") throw new Error(`${label} did not return a settled x402 response`);
  console.log(JSON.stringify({ label, settlement: payment.header, result: await response.json() }));
}

const weather = serviceOrigin("FINITY_PROVIDER_A_URL");
const summarize = serviceOrigin("FINITY_PROVIDER_B_URL");
await purchase("hello-weather", `${weather}/weather?city=Kolkata`);
await purchase("summarize-lite", `${summarize}/summarize`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: "Finity authorizes a narrow purchase only after a mandate permits the specific provider, service, method, price, asset, and data class." }),
});
