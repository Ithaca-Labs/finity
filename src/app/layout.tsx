import type { ReactNode } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { MotionRoot } from "@/components/motion-root";
import { SketchDefs } from "@/components/sketch";
import { themeScript } from "@/components/theme";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });

export const metadata = {
  title: "finity · Trade from shielded ZEC",
  description: "A wallet for the round trip: shielded ZEC out to a fresh Hyperliquid account, and home again. Testnet prototype.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body id="top">
        <SketchDefs />
        <MotionRoot>{children}</MotionRoot>
      </body>
    </html>
  );
}
