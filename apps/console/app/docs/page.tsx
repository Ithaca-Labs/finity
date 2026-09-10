const downloadHref = "/downloads/finity-0.1.0.tar.gz";

function Mark() {
  return <span className="pixel-avatar small" aria-hidden="true" />;
}

function DocsHeader() {
  return (
    <header className="minimal-header docs-topbar shell">
      <a className="tiny-brand" href="/" aria-label="Finity home"><Mark /> finity</a>
      <nav aria-label="Primary navigation">
        <a href="/">home</a>
        <span className="nav-divider">/</span>
        <a href={downloadHref} download>download ↓</a>
      </nav>
    </header>
  );
}

function CodeBlock({ children }: Readonly<{ children: string }>) {
  return <pre className="code-block"><code>{children}</code><span className="code-lang">shell</span></pre>;
}

export default function DocsPage() {
  return (
    <main className="docs-page">
      <DocsHeader />
      <div className="docs-layout shell">
        <aside className="docs-sidebar">
          <p>docs / v0.1.0</p>
          <nav aria-label="Documentation sections">
            <a href="#start">start here</a>
            <a href="#flow">how it works</a>
            <a href="#install">install & run</a>
            <a href="#policy">policy outcomes</a>
            <a href="#trust">trust boundaries</a>
          </nav>
        </aside>

        <article className="docs-content">
          <section className="docs-hero" id="start">
            <p className="docs-label">documentation / 00</p>
            <h1>The system notes.</h1>
            <p>Finity is a Ledger-governed commerce network on Hedera testnet. It lets an agent discover paid services and act inside a boundary a human has clear-signed.</p>
          </section>

          <section className="doc-section" id="flow">
            <p className="doc-section-label">01 / how it works</p>
            <div>
              <h2>Authority starts on a screen only a human can approve.</h2>
              <p>The Principal clear-signs a human-readable Agent Mandate on a physical Ledger. Finity turns that authority into a deterministic path: discover, quote, evaluate, reserve, pay, and record.</p>
              <div className="flow-list">
                <div><span>01</span><strong>Set the boundary</strong><small>Allowed providers, services, methods, assets, data rules, and spend limits.</small></div>
                <div><span>02</span><strong>Find a service</strong><small>Signed service manifests and signed quotes are discovered by the broker.</small></div>
                <div><span>03</span><strong>Evaluate the quote</strong><small>The pure policy engine checks every predicate and collects every failure.</small></div>
                <div><span>04</span><strong>Pay and call</strong><small>A capability scopes the request before the vault injects credentials.</small></div>
                <div><span>05</span><strong>Leave a trail</strong><small>Decision, payment, usage, and reconciliation receipts are hash-chained to HCS.</small></div>
              </div>
            </div>
          </section>

          <section className="doc-section" id="install">
            <p className="doc-section-label">02 / install & run</p>
            <div>
              <h2>Get the source, then run the proof.</h2>
              <p>The archive includes the TypeScript monorepo, provider examples, Solidity registry, tests, and demo script.</p>
              <CodeBlock>{"pnpm install\npnpm -r build\npnpm demo"}</CodeBlock>
              <a className="inline-download" href={downloadHref} download>download source package ↓</a>
            </div>
          </section>

          <section className="doc-section" id="policy">
            <p className="doc-section-label">03 / policy outcomes</p>
            <div>
              <h2>Every result has a reason.</h2>
              <p>Unknown, missing, or malformed policy and payment inputs fail closed as <code>STATE_UNAVAILABLE</code>. Otherwise, the outcome is one of three typed states.</p>
              <div className="outcome-list">
                <div><b>authorized</b><span>No failing predicates. A single-use capability can be minted and the request can settle.</span></div>
                <div><b>escalation</b><span>Only spend limits fail. The agent can propose an amendment for fresh Ledger approval.</span></div>
                <div><b>refused</b><span>Any other failure. No payment, capability, or credential access is allowed.</span></div>
              </div>
            </div>
          </section>

          <section className="doc-section" id="trust">
            <p className="doc-section-label">04 / trust boundaries</p>
            <div>
              <h2>Three processes. One narrow handoff.</h2>
              <p>Secrets stay out of the agent transcript. The Ledger signs authority; it never signs individual x402 payments.</p>
              <div className="boundary-list">
                <div><b>A / buyer</b><strong>Pi agent</strong><span>Receives intents, decisions, receipts, and service output. Never sees keys or plaintext credentials.</span></div>
                <div><b>B / broker</b><strong>finityd</strong><span>Runs discovery, negotiation, policy evaluation, capability minting, and trace building.</span></div>
                <div><b>C / vault</b><strong>vault-worker</strong><span>Decrypts sealed bundles for a lease, injects credentials, enforces egress, and pays.</span></div>
              </div>
            </div>
          </section>

          <p className="docs-footer-note">full architecture → <a href="https://github.com/Ithaca-Labs/finity/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">docs/ARCHITECTURE.md</a></p>
        </article>
      </div>
    </main>
  );
}
