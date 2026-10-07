// Nonsecret operation journal. Never write keys, seeds or signatures here.
export type JournalEntry = { ts: string; network: "testnet" | "mainnet"; kind: string; account: string; data: Record<string, unknown> };
const SECRET = /priv|seed|mnemonic|secret|signature/i;

export function makeEntry(e: Omit<JournalEntry, "ts">): JournalEntry {
  const bad = Object.keys(e.data).find((k) => SECRET.test(k));
  if (bad) throw new Error(`Refusing to journal secret-looking field: ${bad}`);
  return { ts: new Date().toISOString(), ...e };
}
