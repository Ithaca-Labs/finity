"use client";
// TradingView advanced chart, embedded via their public widget script and themed to match the wallet.
import { useEffect, useRef } from "react";
import { useTheme } from "@/components/theme";

/** Mainnet reference markets for each asset the wallet shows. */
export const TV_SYMBOL = {
  zec: "BINANCE:ZECUSDT",
  usdc: "COINBASE:USDCUSD",
  perp: "BYBIT:HYPEUSDT",
  btc: "BINANCE:BTCUSDT",
  eth: "BINANCE:ETHUSDT",
} as const;

export function TvChart({ symbol, interval = "60" }: { symbol: string; interval?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.type = "text/javascript";
    s.innerHTML = JSON.stringify({
      symbol, interval, autosize: true, theme, style: "1", locale: "en", timezone: "Etc/UTC",
      hide_top_toolbar: false, hide_legend: false, hide_side_toolbar: true, allow_symbol_change: false,
      save_image: false, calendar: false, support_host: "https://www.tradingview.com",
      backgroundColor: theme === "dark" ? "#060824" : "#f4efe6",
      gridColor: theme === "dark" ? "rgba(143, 178, 255, 0.06)" : "rgba(29, 63, 166, 0.06)",
    });
    el.appendChild(s);
    return () => { el.innerHTML = ""; };
  }, [symbol, interval, theme]);
  return <div ref={ref} className="tv-chart tradingview-widget-container" />;
}
