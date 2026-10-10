// Per-user Hyperliquid account created and kept in the user's browser; finity never holds it.
// The account key owns the funds and only signs agent approval and returns (transfers).
// The trading key is a Hyperliquid agent: it can place and cancel orders but cannot withdraw.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Network } from "../bridge/guardians";
import { createHl, type Hl } from "../hl/client";
import { persistentNonceManager, type Kv } from "../hl/orders";

export const AGENT_NAME = "finity";

export interface StoredAccount {
  version: 1;
  network: Network;
  accountKey: `0x${string}`;
  tradingKey: `0x${string}`;
  createdAt: string;
  backedUpAt?: string;
}

const storageKey = (network: Network) => `finity.account.v1.${network}`;

export function loadAccount(kv: Kv | undefined, network: Network): StoredAccount | null {
  try {
    const raw = kv?.getItem(storageKey(network));
    const a = raw ? (JSON.parse(raw) as StoredAccount) : null;
    return a?.version === 1 && a.network === network ? a : null;
  } catch { return null; }
}

export function saveAccount(kv: Kv | undefined, a: StoredAccount) {
  kv?.setItem(storageKey(a.network), JSON.stringify(a));
}

export function createAccount(kv: Kv | undefined, network: Network): StoredAccount {
  const existing = loadAccount(kv, network);
  if (existing) return existing; // never silently replace a key that may hold funds
  const a: StoredAccount = { version: 1, network, accountKey: generatePrivateKey(), tradingKey: generatePrivateKey(), createdAt: new Date().toISOString() };
  saveAccount(kv, a);
  return a;
}

/** Restore from a backup file; refuses to overwrite a different stored account. */
export function importAccount(kv: Kv | undefined, network: Network, json: string): StoredAccount {
  const a = JSON.parse(json) as StoredAccount;
  if (a.version !== 1 || a.network !== network || !/^0x[0-9a-f]{64}$/i.test(a.accountKey) || !/^0x[0-9a-f]{64}$/i.test(a.tradingKey)) {
    throw new Error(`Not a finity ${network} account backup`);
  }
  const existing = loadAccount(kv, network);
  if (existing && existing.accountKey !== a.accountKey) throw new Error("A different account is already stored in this browser");
  saveAccount(kv, a);
  return a;
}

export function backupFile(a: StoredAccount) {
  const address = privateKeyToAccount(a.accountKey).address;
  return { name: `finity-${a.network}-${address.slice(0, 8)}.json`, body: JSON.stringify(a, null, 2) };
}

export function markBackedUp(kv: Kv | undefined, a: StoredAccount): StoredAccount {
  const next = { ...a, backedUpAt: new Date().toISOString() };
  saveAccount(kv, next);
  return next;
}

/** Signing clients: `owner` for approvals and transfers, `trader` (agent) for orders. Both act on the owner's account. */
export function accountClients(a: StoredAccount, kv: Kv | undefined) {
  const owner = privateKeyToAccount(a.accountKey);
  const agent = privateKeyToAccount(a.tradingKey);
  const nonceManager = persistentNonceManager(kv);
  return {
    address: owner.address,
    agentAddress: agent.address,
    owner: createHl(a.network, owner, { nonceManager }),
    trader: createHl(a.network, agent, { nonceManager }),
  };
}

export async function isAgentApproved(hl: Hl, user: `0x${string}`, agentAddress: `0x${string}`) {
  const agents = await hl.info.extraAgents({ user });
  return agents.some((x) => x.address.toLowerCase() === agentAddress.toLowerCase() && (x.validUntil == null || x.validUntil > Date.now()));
}

/** One owner signature authorising the trading key. Needs the account to exist on HL (i.e. funded). */
export async function approveTradingKey(owner: Hl, agentAddress: `0x${string}`) {
  return owner.exchange!.approveAgent({ agentAddress, agentName: AGENT_NAME });
}
