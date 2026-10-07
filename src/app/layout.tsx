import type { ReactNode } from "react";
export const metadata = { title: "Shielded ZEC Trading (testnet prototype)" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en"><body style={{ fontFamily: "system-ui", margin: 0 }}>{children}</body></html>);
}
