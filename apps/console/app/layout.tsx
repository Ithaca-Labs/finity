import type { Metadata } from "next";
import { SmoothScroll } from "./components/SmoothScroll";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finity — Agent commerce with a clear boundary",
  description:
    "A Ledger-governed commerce network for AI agents on Hedera testnet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
