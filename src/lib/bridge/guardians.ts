// Guardian signature verification for Unit address responses.
// Keys are pinned per network (source: docs.hyperunit.xyz guardian-signatures, fetched 7 Oct 2026).
export type Network = "testnet" | "mainnet";

export const GUARDIAN_SIGNATURE_THRESHOLD = 2;

export const GUARDIAN_KEYS: Record<Network, { nodeId: string; publicKey: string }[]> = {
  testnet: [
    { nodeId: "node-1", publicKey: "04bab844e8620c4a1ec304df6284cd6fdffcde79b3330a7bffb1e4cecfee72d02a7c1f3a4415b253dc8d6ca2146db170e1617605cc8a4160f539890b8a24712152" },
    { nodeId: "hl-node-testnet", publicKey: "04502d20a0d8d8aaea9395eb46d50ad2d8278c1b3a3bcdc200d531253612be23f5f2e9709bf3a3a50d1447281fa81aca0bf2ac2a6a3cb8a12978381d73c24bb2d9" },
    { nodeId: "field-node", publicKey: "04e674a796ff01d6b74f4ee4079640729797538cdb4926ec333ce1bd18414ef7f22c1a142fd76dca120614045273f30338cd07d79bc99872c76151756aaec0f8e8" },
  ],
  mainnet: [
    { nodeId: "unit-node", publicKey: "04dc6f89f921dc816aa69b687be1fcc3cc1d48912629abc2c9964e807422e1047e0435cb5ba0fa53cb9a57a9c610b4e872a0a2caedda78c4f85ebafcca93524061" },
    { nodeId: "hl-node", publicKey: "048633ea6ab7e40cdacf37d1340057e84bb9810de0687af78d031e9b07b65ad4ab379180ab55075f5c2ebb96dab30d2c2fab49d5635845327b6a3c27d20ba4755b" },
    { nodeId: "field-node", publicKey: "04ae2ab20787f816ea5d13f36c4c4f7e196e29e867086f3ce818abb73077a237f841b33ada5be71b83f4af29f333dedc5411ca4016bd52ab657db2896ef374ce99" },
  ],
};

export interface Proposal {
  destinationAddress: string;
  destinationChain: string;
  asset: string;
  address: string;
  sourceChain: string;
  coinType?: string;
}

export interface VerificationResult {
  success: boolean;
  verifiedCount: number;
  details: Record<string, boolean>;
}

const enc = { encode: (s: string) => new Uint8Array(new TextEncoder().encode(s)) };

const legacyPayload = (nodeId: string, p: Proposal) =>
  enc.encode(`${nodeId}:${[p.destinationAddress, p.destinationChain, p.asset, p.address, p.sourceChain, "deposit"].join("-")}`);

const newPayload = (nodeId: string, p: Proposal) =>
  enc.encode(`${nodeId}:${["user", p.coinType, p.destinationChain, p.destinationAddress, p.address].join("-")}`);

const hexToBytes = (hex: string) => new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const b64ToBytes = (b64: string) => new Uint8Array(Array.from(atob(b64), (c) => c.charCodeAt(0)));

async function verifyOne(publicKeyHex: string, message: Uint8Array<ArrayBuffer>, signatureB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const sig = b64ToBytes(signatureB64);
    if (sig.length !== 64) return false;
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, message);
  } catch {
    return false;
  }
}

/** Accepts only signatures from the given network's pinned keys; needs >= 2 of 3 valid. */
export async function verifyDepositAddressSignatures(
  network: Network,
  signatures: Record<string, string>,
  proposal: Proposal,
): Promise<VerificationResult> {
  const details: Record<string, boolean> = {};
  await Promise.all(
    GUARDIAN_KEYS[network].map(async (node) => {
      const sig = signatures[node.nodeId];
      if (!sig) return void (details[node.nodeId] = false);
      let ok = false;
      if (proposal.coinType !== "ethereum") ok = await verifyOne(node.publicKey, legacyPayload(node.nodeId, proposal), sig);
      if (!ok) ok = await verifyOne(node.publicKey, newPayload(node.nodeId, proposal), sig);
      details[node.nodeId] = ok;
    }),
  );
  const verifiedCount = Object.values(details).filter(Boolean).length;
  return { success: verifiedCount >= GUARDIAN_SIGNATURE_THRESHOLD, verifiedCount, details };
}
