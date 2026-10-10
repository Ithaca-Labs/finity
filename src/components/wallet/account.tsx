"use client";
// One finity account for the whole wallet session: the browser-held account from lib/account,
// read once in the wallet layout and shared by every screen.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
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
  const acct = useLocalAccount(NETWORK);
  const [sheet, setSheet] = useState(false);
  const c = acct.clients;
  const value = useMemo<Account>(() => ({
    acct,
    user: (c?.address ?? ZERO) as `0x${string}`,
    valid: !!c,
    backedUp: !!acct.account?.backedUpAt,
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
