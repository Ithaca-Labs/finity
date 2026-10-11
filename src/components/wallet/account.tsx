"use client";
// One finity account for the whole wallet session, shared by every screen.
// Trading runs on finity's central Hyperliquid testnet wallet: its key stays on the server (see /api/hl).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { centralAddress, centralHl } from "@/lib/central/client";
import type { Network } from "@/lib/bridge/guardians";
import { useAccount as useLocalAccount } from "@/lib/account/use-account";

export const NETWORK: Network = "testnet";
const ZERO = "0x0000000000000000000000000000000000000000" as const;

type Account = {
  acct: ReturnType<typeof useLocalAccount>;
  /** The account (owner) address, or the zero address before one exists. */
  user: `0x${string}`;
  /** True once an account exists in this browser and can sign. */
  valid: boolean;
  backedUp: boolean;
  sheet: boolean;
  setSheet: (open: boolean) => void;
};

const Ctx = createContext<Account | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const local = useLocalAccount(NETWORK);
  const [sheet, setSheet] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  useEffect(() => { centralAddress().then(setAddress).catch(() => setAddress(null)); }, []);
  // Present the central wallet through the same shape the screens already use.
  const c = useMemo(() => {
    if (!address) return null;
    const hl = centralHl();
    return { address, agentAddress: address, owner: hl, trader: hl };
  }, [address]);
  const acct = useMemo(() => ({
    ...local,
    loaded: local.loaded && address !== null,
    clients: c,
    account: local.account ?? ({ backedUpAt: new Date().toISOString() } as NonNullable<typeof local.account>),
    ensureTrading: async () => {},
  }), [local, c, address]);
  const value = useMemo<Account>(() => ({
    acct,
    user: (c?.address ?? ZERO) as `0x${string}`,
    valid: !!c,
    backedUp: true,
    sheet,
    setSheet,
  }), [acct, c, sheet]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccount outside AccountProvider");
  return v;
}

export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
