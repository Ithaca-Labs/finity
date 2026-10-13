// Site identity for metadata, sitemap, robots and structured data.
const host = "https://finity.click";

export const SITE = {
  url: host,
  name: "finity",
  title: "finity · Trade on Hyperliquid from shielded ZEC",
  description: "Fund a Hyperliquid trading account from shielded Zcash, swap to USDC, trade perps, and send your ZEC home. Privacy kept end to end. Testnet prototype.",
  keywords: ["finity", "Zcash", "ZEC", "shielded ZEC", "Hyperliquid", "XZEC", "Unit bridge", "perps", "perpetual futures", "privacy", "crypto trading", "DeFi"],
  routes: [
    { path: "/", priority: 1 },
    { path: "/fund", priority: 0.8 },
    { path: "/trade", priority: 0.8 },
    { path: "/wallet", priority: 0.6 },
    { path: "/return", priority: 0.6 },
  ],
} as const;

const OG_IMAGE = { url: "/opengraph-image.jpg", width: 1200, height: 630, alt: "finity: trade on Hyperliquid from shielded Zcash" };

/** Full per-page metadata: a child's openGraph/twitter replace the parent's wholesale, so repeat the shared fields. */
export function pageMeta(path: string, title: string, description: string) {
  const full = `${title} · ${SITE.name}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website" as const, siteName: SITE.name, locale: "en_US", url: path, title: full, description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image" as const, title: full, description, images: [OG_IMAGE] },
  };
}
