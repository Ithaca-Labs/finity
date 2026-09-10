import { CopyCommand } from "./components/CopyCommand";

const downloadHref = "/downloads/finity-0.1.0.tar.gz";

function Mark() {
  return <span className="pixel-avatar" aria-hidden="true" />;
}

export default function HomePage() {
  return (
    <main className="minimal-page">
      <header className="minimal-header shell">
        <a className="tiny-brand" href="/" aria-label="Finity home">finity</a>
        <nav aria-label="Primary navigation">
          <a href="/docs">docs</a>
          <span className="nav-divider">/</span>
          <a href="https://github.com/Ithaca-Labs/finity" target="_blank" rel="noreferrer">github ↗</a>
        </nav>
      </header>

      <section className="minimal-hero">
        <Mark />
        <h1>finity</h1>
        <p className="minimal-kicker">agent commerce, with boundaries</p>
        <p className="minimal-description">Ledger-governed payments for AI agents<br />with public proof on Hedera.</p>

        <div className="chip-row" aria-label="Finity capabilities">
          <span>ledger authority</span>
          <span>hedera testnet</span>
          <span>x402 services</span>
          <span>hcs receipts</span>
        </div>

        <CopyCommand command="pnpm demo" />

        <div className="minimal-actions">
          <a href={downloadHref} download>download package ↓</a>
          <span>/</span>
          <a href="/docs">read docs →</a>
        </div>
      </section>

      <footer className="minimal-footer shell">
        <span>v0.1.0 · open source</span>
        <span>commerce with a conscience</span>
      </footer>
    </main>
  );
}
