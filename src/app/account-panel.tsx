"use client";
import { useState } from "react";
import type { useAccount } from "@/lib/account/use-account";

/** Create, restore and back up the browser-held trading account. Shown at the top of every flow page. */
export function AccountPanel({ acct }: { acct: ReturnType<typeof useAccount> }) {
  const [err, setErr] = useState<string | null>(null);
  if (!acct.loaded) return null;

  if (!acct.account) return (
    <section className="panel">
      <h2>Your trading account</h2>
      <p>finity creates a fresh Hyperliquid account for you in this browser. Its keys never leave your device, and finity cannot move your funds.</p>
      <button onClick={acct.create}>Create account</button>{" "}
      <label className="link">or restore a backup <input type="file" accept="application/json" onChange={async (e) => {
        setErr(null);
        const f = e.target.files?.[0];
        if (f) try { acct.restore(await f.text()); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
      }} /></label>
      {err && <div className="note bad">{err}</div>}
    </section>
  );

  return (
    <section className="panel">
      <h2>Your trading account</h2>
      <p className="mono">{acct.clients!.address}</p>
      {acct.account.backedUpAt
        ? <p style={{ fontSize: 13 }}>Backed up {new Date(acct.account.backedUpAt).toLocaleString()}. <button onClick={acct.downloadBackup}>Download again</button></p>
        : <div className="note warn"><b>Back up this account before depositing.</b> It lives only in this browser: clearing site data without a backup loses access to the funds.{" "}
            <button onClick={acct.downloadBackup}>Download backup</button></div>}
    </section>
  );
}
