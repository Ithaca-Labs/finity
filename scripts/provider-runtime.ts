import {
  signManifest,
  type CanonicalSigner,
  type UnsignedServiceManifest,
} from "@finity/provider-sdk";
import type { ServiceManifest } from "@finity/schemas";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

type ProviderName = "A" | "B";

export type ProviderRuntime = {
  baseUrl: string;
  manifest: ServiceManifest;
  signer: CanonicalSigner;
  port: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function providerValue(provider: ProviderName, key: string): string {
  return required(`FINITY_PROVIDER_${provider}_${key}`);
}

function validatePublicBaseUrl(value: string): string {
  const url = new URL(value);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("provider URL must use HTTPS (HTTP is allowed only for localhost development)");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("provider URL must be an origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

function port(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("provider port must be 1-65535");
  return parsed;
}

function canonicalSigner(privateKey: string): { signer: CanonicalSigner; publicKey: string } {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("provider signing key must be a 32-byte 0x-prefixed ECDSA private key");
  }
  const account = privateKeyToAccount(privateKey as Hex);
  return {
    signer: {
      async sign(canonicalJson) {
        return account.signMessage({ message: canonicalJson });
      },
    },
    publicKey: account.publicKey,
  };
}

export async function loadProviderRuntime(
  provider: ProviderName,
  template: UnsignedServiceManifest,
): Promise<ProviderRuntime> {
  const baseUrl = validatePublicBaseUrl(providerValue(provider, "URL"));
  const account = providerValue(provider, "ACCOUNT");
  const signing = canonicalSigner(providerValue(provider, "SIGNING_EVM_PRIVATE_KEY"));
  const configured: UnsignedServiceManifest = {
    ...template,
    provider: { ...template.provider, hederaAccount: account, signingKey: signing.publicKey },
    baseUrl,
    methods: template.methods.map((method) => ({
      ...method,
      inputSchemaRef: `${baseUrl}/schemas/${encodeURIComponent(method.id)}-request.json`,
      outputSchemaRef: `${baseUrl}/schemas/${encodeURIComponent(method.id)}-response.json`,
    })),
    payTo: account,
    receiptKey: signing.publicKey,
    publishedAt: Math.floor(Date.now() / 1000),
  };
  return {
    baseUrl,
    manifest: await signManifest(configured, signing.signer),
    signer: signing.signer,
    port: port(process.env[`FINITY_PROVIDER_${provider}_PORT`] ?? (provider === "A" ? "3001" : "3002")),
  };
}
