import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta("/return", "Send ZEC home", "Close positions, convert back to ZEC, and withdraw to your own Zcash wallet.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
