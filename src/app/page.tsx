import Link from "next/link";
import { Scribble, Star } from "@/components/brand";

const ROUTE: { side: "zc" | "hl"; title: string; who: string; time: string }[] = [
  { side: "zc", title: "Send from your shielded wallet", who: "Your wallet pays a one-time bridge address. Minimum 0.07 ZEC.", time: "You" },
  { side: "zc", title: "Zcash confirms", who: "100 confirmations. The address is checked against 2 of 3 bridge guardians first.", time: "~2 hours" },
  { side: "hl", title: "Turn ZEC into USDC", who: "A price-capped swap on Hyperliquid. Partial fills are shown as partial.", time: "Seconds" },
  { side: "hl", title: "Trade", who: "In your own fresh account. Closing a position is never blocked.", time: "Your call" },
  { side: "hl", title: "Send ZEC home", who: "Buy ZEC back and send it to a fresh address from your own wallet.", time: "~2 hours" },
  { side: "zc", title: "Shield it", who: "One tap in your wallet. We only call it shielded when you say so.", time: "One tap" },
];

const STEPS = [
  { n: 1, href: "/fund", title: "Fund", body: "Scan a QR code from your Zcash wallet. Your ZEC lands in a brand-new trading account that has no link to your wallet history.", go: "Add ZEC" },
  { n: 2, href: "/trade", title: "Trade", body: "Swap to USDC and go long or short on Hyperliquid. Every order is reviewed before you sign, and fees are shown up front.", go: "Open the desk" },
  { n: 3, href: "/return", title: "Return", body: "Close out, buy ZEC back, and send it home to your wallet. We track every coin until it's back in your hands.", go: "Bring it home" },
];

export default function Home() {
  return (
    <main>
      <section className="page hero">
        <span className="eyebrow"><Star /> Zcash × Hyperliquid</span>
        <h1>
          Trade in the open.
          <br />
          Come home <em>shielded.<Scribble /></em>
        </h1>
        <p className="lede">
          finity moves your shielded ZEC into a fresh Hyperliquid account, lets you trade, and walks it back to your wallet,
          so your trading never touches your wallet history. You keep the keys the whole way.
        </p>
        <div className="btn-row">
          <Link className="btn btn-lg" href="/fund">Start with ZEC →</Link>
          <Link className="btn btn-lg btn-ghost" href="/return">I have funds to bring back</Link>
        </div>
        <span className="banner"><i />Testnet preview · no real funds</span>
      </section>

      <div className="poster">
        <img className="only-light" src="/brand/finity-banner.webp" alt="finity" />
        <img className="only-dark" src="/brand/finity-dark-banner.webp" alt="finity" />
        <span className="poster-tag"><Star /> Finite trip · infinite privacy</span>
      </div>

      <section className="page section">
        <div className="section-head">
          <span className="eyebrow"><Star /> How it works</span>
          <h2>Three steps, <em>one round trip.</em></h2>
        </div>
        <div className="journey">
          {STEPS.map((s) => (
            <Link key={s.href} href={s.href} className="card">
              <div className="journey-top"><span className="card-n">{s.n}</span><span className="journey-go">{s.go} ↗</span></div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="page section">
        <div className="section-head">
          <span className="eyebrow"><Star /> The journey of your ZEC</span>
          <h2>What happens, <em>and how long it takes.</em></h2>
        </div>
        <div className="card">
          <ol className="timeline">
            {ROUTE.map((s, i) => (
              <li key={s.title} data-side={s.side}>
                <span className="timeline-dot">{i + 1}</span>
                <span className="when">{s.time}</span>
                <b>{s.title}</b>
                <small>{s.who}</small>
              </li>
            ))}
          </ol>
          <div className="legend">
            <span><i className="zc" />On Zcash</span>
            <span><i />On Hyperliquid</span>
          </div>
        </div>
      </section>

      <section className="page section">
        <div className="section-head">
          <span className="eyebrow"><Star /> Straight talk</span>
          <h2>What stays <em>private,</em> and what doesn&apos;t.</h2>
        </div>
        <div className="truths">
          <div className="card">
            <Star />
            <h3>The bridge is visible</h3>
            <p>The amounts leaving and returning to Zcash, and the short transparent handoff, can be seen on-chain.</p>
          </div>
          <div className="card">
            <Star />
            <h3>Trading is public</h3>
            <p>Deposits, positions, fills and PnL are public on Hyperliquid. What&apos;s hidden is the link back to your wallet.</p>
          </div>
          <div className="card">
            <Star />
            <h3>We hold nothing</h3>
            <p>Your keys stay with you. The Unit bridge&apos;s guardians hold the backing ZEC only while it&apos;s on Hyperliquid.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
