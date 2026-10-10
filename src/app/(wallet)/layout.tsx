import type { ReactNode } from "react";
import { WalletShell } from "@/components/wallet/shell";

export default function WalletLayout({ children }: { children: ReactNode }) {
  return <WalletShell>{children}</WalletShell>;
}
