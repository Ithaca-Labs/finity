import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta("/fund", "Deposit ZEC", "Send shielded ZEC from your Zcash wallet and receive XZEC on Hyperliquid, ready to trade.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
