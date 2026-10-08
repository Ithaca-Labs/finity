// Journaled spot transfers (the Unit return send, and test transfers). Same discipline as orders:
// the record is written BEFORE the request, carries the exact signed nonce, and a transfer whose outcome is
// unknown blocks every further transfer until it is reconciled against HL's own ledger. Never auto-retried.
//
// Unlike orders, a user-signed spotSend has no expiry, so "not in the ledger yet" is never proof it will not
// land. Resending is possible only through an explicit, recorded user override after a settling period.
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Network } from "../bridge/guardians";
import { createHl } from "./client";
import { persistentNonceManager, withAccountLock, type Kv } from "./orders";

export type TransferState = "pending" | "unknown" | "sent" | "rejected" | "not_landed";
export const TRANSFER_BLOCKING: readonly TransferState[] = ["pending", "unknown"];
/** After this long with no ledger entry the UI may offer an explicit "I accept the risk" override. */
export const TRANSFER_SETTLE_MS = 10 * 60_000;

export interface TransferRecord {
  id: string;
  network: Network;
  account: string;
  purpose: string; // e.g. "unit_withdrawal", "test"
  token: string; // spotSend selector "NAME:0xtokenId"
  amount: string;
  destination: `0x${string}`;
  nonce: number; // the exact signed nonce: how an unknown transfer is found again in the ledger
  state: TransferState;
  error?: string;
  evidence?: "exchange_response" | "reconciled_ledger" | "user_override";
  ledgerTime?: number;
  ledgerHash?: string;
  /** Fee HL charged the sender, read back from the ledger (e.g. 1 USDC to activate a new account). */
  fee?: string;
  feeToken?: string;
  overrideAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class TransferLedger {
  private key: string;
  constructor(private kv: Kv | undefined, network: Network, account: string) {
    this.key = `transfers:${network}:${account.toLowerCase()}`;
  }
  list(): TransferRecord[] {
    try { return JSON.parse(this.kv?.getItem(this.key) ?? "[]"); } catch { return []; }
  }
  get(id: string) { return this.list().find((r) => r.id === id); }
  put(rec: TransferRecord) {
    const all = this.list().filter((r) => r.id !== rec.id);
    all.unshift({ ...rec, updatedAt: new Date().toISOString() });
    this.kv?.setItem(this.key, JSON.stringify(all.slice(0, 100)));
  }
  blocking() { return this.list().find((r) => TRANSFER_BLOCKING.includes(r.state)); }
}

export class TransferBlockedError extends Error {
  constructor(public record: TransferRecord) {
    super(`Transfer ${record.id} (${record.purpose}, ${record.amount} ${record.token.split(":")[0]}) has an unknown outcome. Reconcile it before sending anything else.`);
  }
}

export interface SpotSendRequest { purpose: string; token: string; amount: string; destination: `0x${string}` }
export type SendFn = (nonce: number, p: { destination: `0x${string}`; token: string; amount: string }) => Promise<unknown>;

const now = () => new Date().toISOString();
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Default sender: a one-shot exchange client whose nonce is exactly the one we journaled. */
export function realSender(network: Network, signer: PrivateKeyAccount): SendFn {
  return (nonce, p) => createHl(network, signer, { nonceManager: () => nonce }).exchange!.spotSend(p);
}

/** Journal, then send once. Returns the record; never throws after the pending record is written. */
export async function submitSpotSend(
  send: SendFn, kv: Kv | undefined, ledger: TransferLedger, network: Network, account: `0x${string}`, req: SpotSendRequest,
): Promise<TransferRecord> {
  if (account.toLowerCase() === req.destination.toLowerCase()) throw new Error("Refusing to send to the same account");
  return withAccountLock(`transfer:${network}:${account.toLowerCase()}`, async () => {
    const blocked = ledger.blocking();
    if (blocked) throw new TransferBlockedError(blocked);
    const rec: TransferRecord = {
      id: newId(), network, account, purpose: req.purpose, token: req.token, amount: req.amount, destination: req.destination,
      nonce: persistentNonceManager(kv)(account), state: "pending", createdAt: now(), updatedAt: now(),
    };
    ledger.put(rec); // journaled before the network call
    try {
      await send(rec.nonce, { destination: rec.destination, token: rec.token, amount: rec.amount });
      Object.assign(rec, { state: "sent", evidence: "exchange_response" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // ApiRequestError = HL answered with a definitive rejection. Anything else may have landed.
      Object.assign(rec, e instanceof ApiRequestError ? { state: "rejected", error: msg } : { state: "unknown", error: msg });
    }
    ledger.put(rec);
    return rec;
  });
}

export interface LedgerApi {
  userNonFundingLedgerUpdates(p: { user: `0x${string}`; startTime: number }): Promise<any[]>;
}

/** Find a journaled transfer in HL's own ledger by its signed nonce, sender and destination. */
export async function reconcileTransfer(api: LedgerApi, ledger: TransferLedger, id: string, nowMs = Date.now()): Promise<TransferRecord> {
  const rec = ledger.get(id);
  if (!rec) throw new Error(`No journaled transfer ${id}`);
  const updates = await api.userNonFundingLedgerUpdates({ user: rec.account as `0x${string}`, startTime: Date.parse(rec.createdAt) - 60_000 });
  const hit = updates.find((u) => {
    const d = u.delta;
    return d?.type === "spotTransfer" && d.nonce === rec.nonce && String(d.user).toLowerCase() === rec.account.toLowerCase()
      && String(d.destination).toLowerCase() === rec.destination.toLowerCase();
  });
  let next: Partial<TransferRecord>;
  if (hit) {
    next = { state: "sent", evidence: "reconciled_ledger", ledgerTime: hit.time, ledgerHash: hit.hash, fee: hit.delta.fee, feeToken: hit.delta.feeToken, error: undefined };
  } else if (nowMs - Date.parse(rec.createdAt) < TRANSFER_SETTLE_MS) {
    next = { state: "unknown", error: `Not in the ledger yet. A transfer can be delayed; check again after ${new Date(Date.parse(rec.createdAt) + TRANSFER_SETTLE_MS).toISOString()}. Do not resend.` };
  } else {
    next = { state: "unknown", error: "Still not in the ledger after the settling period. It most likely did not land, but this cannot be proven; resending needs your explicit override." };
  }
  const out = { ...rec, ...next } as TransferRecord;
  ledger.put(out);
  return out;
}

/** Explicit user override: records that the user accepted the double-send risk. Only after the settling period. */
export function overrideNotLanded(ledger: TransferLedger, id: string, nowMs = Date.now()): TransferRecord {
  const rec = ledger.get(id);
  if (!rec) throw new Error(`No journaled transfer ${id}`);
  if (rec.state !== "unknown") throw new Error(`Transfer is ${rec.state}, nothing to override`);
  if (nowMs - Date.parse(rec.createdAt) < TRANSFER_SETTLE_MS) throw new Error("Too early: wait for the settling period before overriding");
  const out: TransferRecord = { ...rec, state: "not_landed", evidence: "user_override", overrideAt: now() };
  ledger.put(out);
  return out;
}
