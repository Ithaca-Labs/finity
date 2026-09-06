import { canonicalize } from "json-canonicalize";
import { keccak256 } from "viem";

export type Hash = `0x${string}`;

export function canonicalizeJson(value: unknown): string {
  try {
    return canonicalize(value);
  } catch (error) {
    throw new TypeError("Value cannot be represented as canonical JSON", {
      cause: error,
    });
  }
}

export function hashCanonicalJson(value: unknown): Hash {
  return keccak256(new TextEncoder().encode(canonicalizeJson(value)));
}

