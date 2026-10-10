import type { ReactNode } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { SketchDefs } from "@/components/brand";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { themeScript } from "@/components/theme";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });

export const metadata = {
  title: "finity · Trade from shielded ZEC",
  description: "Fund a fresh Hyperliquid account from your shielded Zcash wallet, trade, and come back. Testnet prototype.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <SketchDefs />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
