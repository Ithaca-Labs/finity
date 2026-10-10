"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Network } from "../bridge/guardians";
import {
  accountClients, approveTradingKey, backupFile, createAccount, importAccount, isAgentApproved, loadAccount, markBackedUp, type StoredAccount,
} from "./local";

const kv = () => { try { return window.localStorage; } catch { return undefined; } };

/** The browser-held finity account for this network, plus its signing clients. */
export function useAccount(network: Network) {
  const [account, setAccount] = useState<StoredAccount | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setAccount(loadAccount(kv(), network)); setLoaded(true); }, [network]);

  const clients = useMemo(() => (account ? accountClients(account, kv()) : null), [account]);

  const create = useCallback(() => setAccount(createAccount(kv(), network)), [network]);
  const restore = useCallback((json: string) => setAccount(importAccount(kv(), network, json)), [network]);
  const downloadBackup = useCallback(() => {
    if (!account) return;
    const f = backupFile(account);
    const url = URL.createObjectURL(new Blob([f.body], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: f.name });
    a.click(); URL.revokeObjectURL(url);
    setAccount(markBackedUp(kv(), account));
  }, [account]);

  /** Approve the trading key with one owner signature if it is not approved yet. */
  const ensureTrading = useCallback(async () => {
    if (!clients) throw new Error("No account");
    if (await isAgentApproved(clients.owner, clients.address, clients.agentAddress)) return;
    const r = await approveTradingKey(clients.owner, clients.agentAddress);
    if (r.status !== "ok") throw new Error(`Trading key approval failed: ${JSON.stringify(r)}`);
  }, [clients]);

  return { loaded, account, clients, create, restore, downloadBackup, ensureTrading };
}
