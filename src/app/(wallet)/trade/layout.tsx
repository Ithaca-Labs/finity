import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta("/trade", "Swap & trade", "Swap XZEC to USDC and trade BTC, ETH and other perps on Hyperliquid.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
