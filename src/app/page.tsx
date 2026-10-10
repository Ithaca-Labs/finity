const ROUTE: { side: "zc" | "hl"; title: string; who: string; time: string; wait?: boolean }[] = [
  { side: "zc", title: "Send from your shielded wallet", who: "Your wallet unshields to a one-time address, then pays Unit's TEX address. Minimum 0.07 ZEC.", time: "you" },
  { side: "zc", title: "100 Zcash confirmations", who: "Deposit address checked against 2 of 3 Unit guardian signatures before you see it.", time: "~125 min", wait: true },
  { side: "hl", title: "Convert to USDC margin", who: "Price-bounded IOC on Hyperliquid spot. A partial fill is shown as partial.", time: "seconds" },
  { side: "hl", title: "Trade", who: "Your own fresh account. Closing and cancelling are never blocked.", time: "—" },
  { side: "hl", title: "Buy ZEC back and send to Unit", who: "To a fresh transparent address from your Zcash wallet, verified the same way.", time: "~130 min", wait: true },
  { side: "zc", title: "Shield in your wallet", who: "We only mark it shielded when your wallet shows it.", time: "one tap" },
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div>
          <h1>Trade on Hyperliquid from <em>shielded&nbsp;ZEC</em>, then come back.</h1>
          <p className="lede">finity funds a fresh trading account from your Zcash wallet, so your wallet history stays separate from your trading. You hold the keys. Unit runs the bridge.</p>
          <div className="actions">
            <a className="btn" href="/fund">Fund an account</a>
            <a className="link" href="/return">Return funds</a>
          </div>
        </div>
        <div className="panel ledger">
          <h2>The round trip</h2>
          <table><tbody>
            {ROUTE.map((s, i) => (
              <tr key={s.title} className={`${s.side}${s.wait ? " wait" : ""}`}>
                <td>{i + 1}</td>
                <td><strong>{s.title}</strong><small>{s.who}</small></td>
                <td>{s.time}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </section>

      <section className="public">
        <h2>What stays public</h2>
        <dl>
          <dt>The bridge leg</dt>
          <dd>Amounts leaving and returning to Zcash, and the transparent handoff, are visible on-chain.</dd>
          <dt>Your trading</dt>
          <dd>Deposits, positions, fills and PnL are public on Hyperliquid. Positions are not confidential.</dd>
          <dt>Custody</dt>
          <dd>finity holds nothing. Unit&apos;s guardians hold the backing ZEC while it is bridged.</dd>
        </dl>
      </section>
    </main>
  );
}
