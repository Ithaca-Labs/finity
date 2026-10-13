import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta("/wallet", "Wallet", "Your finity balances across Zcash and Hyperliquid in one place.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
