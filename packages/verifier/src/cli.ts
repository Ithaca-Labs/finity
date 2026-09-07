#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRegistryClient } from "@finity/registry-client";
import type { DecisionReceipt, Quote, ServiceManifest, SignedAgentMandate } from "@finity/schemas";
import { verify } from "./verify.js";

/**
 * `finity-verify --receipt <file> --mandate <id>` (FINITY_BUILD_SPEC.md
 * step 20): reconstructs a decision from public registry state, the
 * mandate's HCS trace, and whatever is disclosed alongside the receipt.
 * Exits 0 for `verified`, 1 for `insufficient_disclosure`, 2 for `invalid`,
 * so it composes into CI/scripts without parsing its own JSON output.
 */

function flag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index === -1 || index === args.length - 1 ? undefined : args[index + 1];
}

function required(name: string): string {
  const value = flag(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

function readJson<T>(path: string): T {
  // Strip a leading UTF-8 BOM: common on Windows-authored JSON (PowerShell's
  // `Out-File -Encoding utf8`, Notepad, some editors), which JSON.parse
  // otherwise rejects outright.
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(1) : raw) as T;
}

const receipt = readJson<DecisionReceipt>(required("--receipt"));
const mandateId = required("--mandate");
if (receipt.mandateId.toLowerCase() !== mandateId.toLowerCase()) {
  throw new Error(`--mandate ${mandateId} does not match the receipt's mandateId ${receipt.mandateId}`);
}

const registryAddress = required("--registry-address");
const verifyingContract = registryAddress as `0x${string}`;
const mandateFile = flag("--mandate-file");
const manifestFile = flag("--manifest-file");
const quoteFile = flag("--quote-file");
const settlementTxId = flag("--settlement-tx");
const rpcUrl = flag("--rpc-url");
const mirrorNodeUrl = flag("--mirror-node-url");

const registryClient = createRegistryClient({ contractAddress: registryAddress, rpcUrl });

const result = await verify({
  receipt,
  registryClient,
  verifyingContract,
  mandate: mandateFile ? readJson<SignedAgentMandate>(mandateFile) : undefined,
  manifest: manifestFile ? readJson<ServiceManifest>(manifestFile) : undefined,
  quote: quoteFile ? readJson<Quote>(quoteFile) : undefined,
  settlementTxId,
  mirrorNodeUrl,
});

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.verdict === "verified" ? 0 : result.verdict === "insufficient_disclosure" ? 1 : 2;
