import { CopyCommand } from "./components/CopyCommand";
import { DemoVideo } from "./components/DemoVideo";

const downloadHref = "/downloads/finity-0.1.0.tar.gz";

export default function HomePage() {
  return (
    <main className="minimal-page">
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
          <p className="minimal-kicker">the agent that knows when to stop</p>
          <p className="minimal-description">Let AI handle the small stuff.<br />Keep the final say.</p>

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

      <section className="landing-section shell" id="why">
        <div className="section-lead">
          <span className="section-index">01 / the difference</span>
          <div>
            <h2>Most AI stops at suggestions. Finity follows through.</h2>
            <p>Your agent can discover, pay, and deliver—inside a boundary you set once.</p>
          </div>
        </div>

        <div className="trust-grid">
          <article className="trust-card">
            <span className="trust-number">01</span>
            <p className="trust-kicker">your rules</p>
            <h3>Set the terms.</h3>
            <p>You choose the services, spend, and access before your agent takes a step.</p>
            <span className="trust-token">you_decide</span>
          </article>
          <article className="trust-card">
            <span className="trust-number">02</span>
            <p className="trust-kicker">its turn</p>
            <h3>Let it follow through.</h3>
            <p>Finity turns a clear mandate into a real action, not another recommendation.</p>
            <span className="trust-token">make_it_real</span>
          </article>
          <article className="trust-card">
            <span className="trust-number">03</span>
            <p className="trust-kicker">after the fact</p>
            <h3>Keep the receipts.</h3>
            <p>Every request leaves a readable trail, whether it goes through or stops.</p>
            <span className="trust-token">know_more</span>
          </article>
        </div>
      </section>

      <section className="landing-section proof-section shell" id="proof">
        <div className="section-lead">
          <span className="section-index">02 / the feeling</span>
          <div>
            <h2>The best kind of autonomy knows when to stop.</h2>
            <p>You get the upside of an agent that acts, without the anxiety of one that improvises.</p>
          </div>
        </div>

        <div className="decision-stage">
          <article className="decision-card allowed">
            <div className="decision-topline">
              <span className="proof-status">a confident yes</span>
              <span className="decision-code">01 / through</span>
            </div>
            <h3>The job gets done.</h3>
            <p>The request fits. Finity clears the way, makes the payment, and brings back the result.</p>
            <div className="decision-foot"><span>outcome</span><strong>delivered</strong></div>
          </article>
          <article className="decision-card stopped">
            <div className="decision-topline">
              <span className="proof-status stopped">a clean no</span>
              <span className="decision-code">02 / stopped</span>
            </div>
            <h3>The line holds.</h3>
            <p>The request is outside the rules. Nothing moves, and you know exactly why.</p>
            <div className="decision-foot"><span>what you keep</span><strong>peace of mind</strong></div>
          </article>
        </div>

        <p className="proof-note"><span aria-hidden="true">→</span> More done. Less babysitting.</p>
      </section>

      <footer className="minimal-footer shell">
        <span>v0.1.0 · open source</span>
        <span>more useful. still yours.</span>
      </footer>
    </main>
  );
}
