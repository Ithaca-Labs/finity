"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark, Star } from "./brand";
import { ThemeToggle } from "./theme";

const STEPS = [
  { href: "/fund", label: "Fund" },
  { href: "/trade", label: "Trade" },
  { href: "/return", label: "Return" },
];

/** Floating paper pills over the page, cut from the same cloth as Finity's desk chrome. */
export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="site-header">
      <Link href="/" className="pill brand" aria-label="finity home">
        <span className="brand-mark"><LogoMark /></span>
        <span>finity</span>
      </Link>
      <nav className="pill steps" aria-label="Journey">
        {STEPS.map((s, i) => (
          <Link key={s.href} href={s.href} aria-current={path.startsWith(s.href) ? "page" : undefined}>
            <span className="steps-n">{i + 1}</span>{s.label}
          </Link>
        ))}
      </nav>
      <div className="pill right">
        <span className="net"><i />Testnet</span>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link href="/" className="foot-brand"><LogoMark className="foot-mark" /><span>finity</span></Link>
      <p><Star className="foot-star" /> Testnet prototype · no real funds · you hold the keys</p>
      <Link href="/fund" className="foot-link">Start a round trip ↗</Link>
    </footer>
  );
}
