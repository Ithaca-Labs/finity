// Phase 5 preflight: read-only refresh of everything the mainnet pilot depends on. Signs and sends nothing.
import { createHl } from "../src/lib/hl/client";
import { resolveSpot, quoteIoc } from "../src/lib/hl/spot";
import { UNIT_ZEC_TOKEN_ID } from "../src/lib/hl/xzec";
import { UnitBridgeAdapter } from "../src/lib/bridge/unit";
const hl = createHl("mainnet");
const m = await resolveSpot(hl, UNIT_ZEC_TOKEN_ID.mainnet);
console.log("token", m.base, "pair", m.pair, "asset", m.asset, "selector", m.tokenSelector);
const book: any = await hl.info.l2Book({ coin: m.pair });
const [bids, asks] = book.levels;
console.log("best bid", bids[0], "best ask", asks[0], "levels", bids.length, asks.length);
for (const sz of [0.1, 0.5, 2]) {
  const s = quoteIoc(book, false, sz, 0.01, m.base.szDecimals), b = quoteIoc(book, true, sz, 0.01, m.base.szDecimals);
  console.log(`sell ${sz}:`, s.ok && { fill: s.estFillSz, avg: s.estAvgPx.toFixed(2) }, ` buy ${sz}:`, b.ok && { fill: b.estFillSz, avg: b.estAvgPx.toFixed(2) });
}
const meta = await hl.info.meta();
const zec = meta.universe.find((u) => u.name === "ZEC");
console.log("ZEC perp", zec);
console.log("fees", await new UnitBridgeAdapter("mainnet").fees());
