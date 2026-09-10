import { CopyCommand } from "./components/CopyCommand";
import { DemoVideo } from "./components/DemoVideo";
import { LandingMotion } from "./components/LandingMotion";

const downloadHref = "/downloads/finity-0.1.0.tar.gz";

export default function HomePage() {
  return (
    <main className="minimal-page">
      <LandingMotion />
      <header className="minimal-header shell">
        <a className="tiny-brand" href="/" aria-label="Finity home">finity</a>
        <nav className="pixel-nav" aria-label="Primary navigation">
          <a className="nav-question" href="#why" aria-label="Why Finity">?</a>
          <span className="nav-divider" aria-hidden="true">|</span>
          <a href="/docs">docs</a>
          <span className="nav-divider" aria-hidden="true">|</span>
          <a className="nav-external" href="https://github.com/Ithaca-Labs/finity" target="_blank" rel="noreferrer">github</a>
        </nav>
      </header>

      <section className="minimal-hero shell">
        <div className="hero-copy">
          <h1>finity</h1>
          <p className="minimal-kicker">let your agent cook. responsibly.</p>
          <p className="minimal-description"><strong>Ledger</strong> sets the limit.<br /><strong>Hedera</strong> keeps the receipts.</p>

          <div className="demo-wrap">
            <CopyCommand command="pnpm demo" />
          </div>

          <div className="minimal-actions">
            <a className="primary-action" href={downloadHref} download>get finity ↓</a>
            <span>/</span>
            <a href="/docs">see how it works →</a>
          </div>
        </div>

        <DemoVideo />
      </section>

      <section className="landing-section proof-section motion-section" id="why">
        <div className="proof-visual motion-card">
          <div className="proof-visual-inner shell">
            <h2 className="proof-visual-heading">Autonomy,<br />with a stopping point.</h2>
            <div className="proof-terms">
              <p className="proof-terms-line">Let your agent act.<br /><strong>Just keep the final say.</strong></p>
              <p className="proof-terms-note">Every action stays inside the boundary you set.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section shell motion-section" id="difference">
        <div className="section-lead">
          <div>
            <h2>Autonomy becomes useful when it stays yours.</h2>
            <p>Set one mandate. Your agent can discover, pay, and deliver—without stepping beyond it.</p>
          </div>
        </div>

        <ol className="mandate-rail">
          <li className="motion-card"><span className="rail-number">01</span><div><p>before it acts</p><h3>You set the terms.</h3></div><span className="rail-detail">services · spend · access</span></li>
          <li className="motion-card"><span className="rail-number">02</span><div><p>when it acts</p><h3>Finity holds the line.</h3></div><span className="rail-detail">policy · capability · payment</span></li>
          <li className="motion-card"><span className="rail-number">03</span><div><p>after it acts</p><h3>The trail remains.</h3></div><span className="rail-detail">receipt · refusal · result</span></li>
        </ol>
      </section>

      <footer className="minimal-footer shell">
        <span>v0.1.0 · open source</span>
        <span>more useful. still yours.</span>
      </footer>
    </main>
  );
}
