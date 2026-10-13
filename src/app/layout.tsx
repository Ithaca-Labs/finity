import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { MotionRoot } from "@/components/motion-root";
import { SketchDefs } from "@/components/sketch";
import { themeScript } from "@/components/theme";
import { SITE } from "@/lib/site";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [...SITE.keywords],
  category: "finance",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE.name, title: SITE.title, description: SITE.description, url: "/", locale: "en_US" },
  twitter: { card: "summary_large_image", title: SITE.title, description: SITE.description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  appleWebApp: { title: SITE.name, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eee7db" },
    { media: "(prefers-color-scheme: dark)", color: "#010118" },
  ],
  colorScheme: "light dark",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: SITE.name, url: SITE.url, description: SITE.description },
    { "@type": "WebApplication", name: SITE.name, url: SITE.url, description: SITE.description, applicationCategory: "FinanceApplication", operatingSystem: "Web", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      </head>
      <body id="top">
        <SketchDefs />
        <MotionRoot>{children}</MotionRoot>
      </body>
    </html>
  );
}
