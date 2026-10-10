"use client";
// One account for the whole wallet session. The trading key lives only in React state in the wallet layout:
// it survives moving between Fund, Trade and Return, but is never written to storage or sent anywhere.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const DEMO_ADDRESS = "0x1f20B96A9fde5218ED05A212B2d23093100785c0";

type Account = {
  key: string;
  setKey: (k: string) => void;
  readAddr: string;
  setReadAddr: (a: string) => void;
  signer: PrivateKeyAccount | undefined;
  user: `0x${string}`;
  valid: boolean;
  sheet: boolean;
  setSheet: (open: boolean) => void;
};

const Ctx = createContext<Account | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState(""); // memory only: never persisted or logged
  const [readAddr, setReadAddr] = useState(DEMO_ADDRESS);
  const [sheet, setSheet] = useState(false);
  const signer = useMemo(() => { try { return /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as `0x${string}`) : undefined; } catch { return undefined; } }, [key]);
  const user = (signer?.address ?? readAddr) as `0x${string}`;
  const valid = /^0x[0-9a-fA-F]{40}$/.test(user);
  const value = useMemo(() => ({ key, setKey, readAddr, setReadAddr, signer, user, valid, sheet, setSheet }), [key, readAddr, signer, user, valid, sheet]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccount outside AccountProvider");
  return v;
}

export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
