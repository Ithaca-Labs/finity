import type { ReactNode } from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata = { title: "finity (testnet prototype)" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable}`}>
      <body>
        <header className="shell-bar">
          <a href="/" className="brand">finity<span>.</span></a>
          <nav className="shell-nav">
            <a href="/fund">Fund</a><a href="/trade">Trade</a><a href="/return">Return</a>
          </nav>
          <span className="net-chip">testnet · no real funds</span>
        </header>
        {children}
      </body>
    </html>
  );
}
