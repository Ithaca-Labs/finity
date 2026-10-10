"use client";
// Wallet home: one balance, four actions, where your round trip is, what you hold, what happened.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { Network } from "@/lib/bridge/guardians";
import { createHl } from "@/lib/hl/client";
import { availableSpot, resolveSpot, type SpotMarket } from "@/lib/hl/spot";
import { needsClassTransfer, readAccountMode } from "@/lib/hl/account";
import { UNIT_ZEC_TOKEN_ID } from "@/lib/hl/xzec";
import { deriveFunding } from "@/lib/bridge/funding";
import { deriveReturn } from "@/lib/bridge/returns";
import { loadFunding, loadReturn } from "@/lib/store/funding-store";
import { useAccount } from "@/components/wallet/account";
import { EASE, Empty, Icon, Rise, Ticker, TokenIcon, TokenRow } from "@/components/wallet/ui";

const NETWORK: Network = "testnet";
const kv = () => { try { return window.localStorage; } catch { return undefined; } };

type Snap = { perps: any; spot: any[]; mids: Record<string, string>; fills: any[]; mode: string };

const ACTIONS = [
  { href: "/fund", label: "Deposit", icon: "fund" },
  { href: "/trade?tab=swap", label: "Swap", icon: "swap" },
  { href: "/trade", label: "Trade", icon: "trade" },
  { href: "/return", label: "Send home", icon: "return" },
] as const;

export default function WalletHome() {
  const { user, valid, signer, setSheet } = useAccount();
  const hl = useMemo(() => createHl(NETWORK), []);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [mkt, setMkt] = useState<SpotMarket | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { resolveSpot(hl, UNIT_ZEC_TOKEN_ID[NETWORK]).then(setMkt).catch(() => {}); }, [hl]);
  const refresh = useCallback(async () => {
    if (!valid) return;
    try {
      const [perps, spot, mids, fills, mode] = await Promise.all([
        hl.info.clearinghouseState({ user }), hl.info.spotClearinghouseState({ user }), hl.info.allMids(), hl.info.userFills({ user }), readAccountMode(hl, user),
      ]);
      setSnap({ perps, spot: spot.balances, mids, fills: fills.slice(0, 6), mode }); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [hl, user, valid]);
  useEffect(() => { setSnap(null); refresh(); const id = setInterval(refresh, 12_000); return () => clearInterval(id); }, [refresh]);

  const zecPx = mkt && snap ? Number(snap.mids[mkt.pair]) || 0 : 0;
  const zecBal = mkt && snap ? Number(snap.spot.find((b) => b.token === mkt.base.index)?.total ?? 0) : 0;
  const usdcSpot = snap ? Number(snap.spot.find((b) => b.token === 0)?.total ?? 0) : 0;
  const perpsValue = snap ? Number(snap.perps.marginSummary.accountValue) : 0;
  const separate = snap ? needsClassTransfer(snap.mode as any) : true;
  // In unified modes spot USDC already counts inside the perps account value.
  const total = perpsValue + (separate ? usdcSpot : 0) + zecBal * zecPx;
  const pnl = snap ? snap.perps.assetPositions.reduce((s: number, p: any) => s + Number(p.position.unrealizedPnl), 0) : 0;
  const positions = snap?.perps.assetPositions ?? [];

  // Where the round trip stands, from this browser's records.
  const trip = useMemo(() => {
    if (!valid) return null;
    const id = { network: NETWORK, hlAddress: user, source: "unit-live" as const };
    const r = loadReturn(kv(), id);
    if (r) { const v = deriveReturn(r); return { href: "/return", label: "Return", state: v.state.replace(/_/g, " "), body: v.explanation }; }
    const f = loadFunding(kv(), id);
    if (f) { const v = deriveFunding(f, null); return { href: "/fund", label: "Deposit", state: v.state.replace(/_/g, " "), body: v.explanation }; }
    return null;
  }, [user, valid, snap]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="home">
      <Rise className="balance">
        <span className="eyebrow">Total balance</span>
        <div className="balance-num"><span className="balance-cur">$</span><Ticker value={snap ? total : 0} /></div>
        <div className="balance-sub">
          {!snap ? <span className="skeleton" style={{ width: 120 }} /> : positions.length ? (
            <span className={pnl >= 0 ? "up" : "down"}>{pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)} open PnL</span>
          ) : <span className="muted">{zecBal > 0 ? `${zecBal} ZEC ready to trade` : "Hyperliquid testnet"}</span>}
        </div>
      </Rise>

      <Rise i={1} className="actions">
        {ACTIONS.map((a, i) => (
          <Link key={a.label} href={a.href} className="action">
            <motion.span className="action-ic" whileHover={{ y: -3 }} whileTap={{ scale: 0.92 }} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 20, delay: 0.1 + i * 0.05 }}>
              <Icon name={a.icon} />
            </motion.span>
            <span>{a.label}</span>
          </Link>
        ))}
      </Rise>

      {!signer && (
        <Rise i={2}>
          <button type="button" className="unlock-banner" onClick={() => setSheet(true)}>
            <Icon name="lock" />
            <span><b>You&apos;re watching this account</b><small>Unlock with your trading key to swap, trade and send.</small></span>
            <span className="chev">›</span>
          </button>
        </Rise>
      )}

      {err && <Rise i={2}><p className="small" style={{ color: "var(--bad)" }}>Couldn&apos;t refresh: {err}. Showing the last known balances.</p></Rise>}

      {trip && (
        <Rise i={3}>
          <Link href={trip.href} className="trip">
            <span className="trip-pulse" />
            <span className="trip-text"><small>{trip.label} · {trip.state}</small><b>{trip.body}</b></span>
            <span className="chev">›</span>
          </Link>
        </Rise>
      )}

      <Rise i={4} className="section">
        <div className="section-head"><h3>Tokens</h3></div>
        <div className="list">
          <TokenRow icon={<TokenIcon kind="zec" />} name="Zcash" sub={mkt ? `${mkt.base.name} · bridged by Unit` : "Bridged by Unit"}
            amount={snap ? `${zecBal} ZEC` : <span className="skeleton" />} value={zecPx ? `$${(zecBal * zecPx).toFixed(2)}` : undefined} />
          <TokenRow icon={<TokenIcon kind="usdc" />} name="USDC" sub={separate ? "Swap balance" : "Swap + trading balance"}
            amount={snap ? usdcSpot.toFixed(2) : <span className="skeleton" />} value={snap ? `$${usdcSpot.toFixed(2)}` : undefined} />
          <TokenRow icon={<TokenIcon kind="perp" />} name="Trading account" sub="Perps margin & PnL"
            amount={snap ? perpsValue.toFixed(2) : <span className="skeleton" />} value={snap ? `withdrawable ${Number(snap.perps.withdrawable).toFixed(2)}` : undefined} />
        </div>
      </Rise>

      {positions.length > 0 && (
        <Rise i={5} className="section">
          <div className="section-head"><h3>Positions</h3><Link href="/trade" className="link-sm">Manage ›</Link></div>
          <div className="list">
            {positions.map(({ position: p }: any) => (
              <TokenRow key={p.coin} icon={<TokenIcon kind={p.coin === "ETH" ? "eth" : "btc"} />} name={`${p.coin} ${Number(p.szi) < 0 ? "Short" : "Long"}`}
                sub={`${Math.abs(Number(p.szi))} @ ${p.entryPx} · ${p.leverage.value}x`}
                amount={<span className={Number(p.unrealizedPnl) >= 0 ? "up" : "down"}>{Number(p.unrealizedPnl) >= 0 ? "+" : ""}{Number(p.unrealizedPnl).toFixed(2)}</span>} value="USDC" />
            ))}
          </div>
        </Rise>
      )}

      <Rise i={6} className="section">
        <div className="section-head"><h3>Recent activity</h3><Link href="/trade?tab=activity" className="link-sm">All ›</Link></div>
        {!snap ? <div className="list"><div className="token-row"><span className="skeleton" style={{ width: "60%" }} /></div></div>
          : snap.fills.length === 0 ? <Empty>Nothing yet. Your first deposit will show up here.</Empty> : (
          <div className="list">
            {snap.fills.map((f, i) => (
              <motion.div key={f.tid} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.04, ease: EASE }}>
                <TokenRow icon={<TokenIcon kind={f.coin.includes("/") ? "usdc" : f.coin === "ETH" ? "eth" : "btc"} />} name={`${f.dir}`} sub={`${f.coin} · ${new Date(f.time).toLocaleTimeString()}`}
                  amount={`${f.sz}`} value={`@ ${f.px}`} />
              </motion.div>
            ))}
          </div>
        )}
      </Rise>
    </div>
  );
}
