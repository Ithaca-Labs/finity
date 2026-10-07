// Phase 0: resolve ZEC-like tokens on HL testnet and inspect their books.
const INFO = "https://api.hyperliquid-testnet.xyz/info";
const XZEC_ID = "0xc8e8047efa1400eb0b7b9bbee16b759d"; // official Unit testnet token metadata

const post = (body: unknown) =>
  fetch(INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

const meta = await post({ type: "spotMeta" });
const zec = meta.tokens.filter((t: any) => /ZEC/i.test(t.name));
console.log("tokens:", zec.map((t: any) => ({ name: t.name, index: t.index, tokenId: t.tokenId, szDecimals: t.szDecimals, weiDecimals: t.weiDecimals })));
const official = zec.find((t: any) => t.tokenId === XZEC_ID);
console.log("official XZEC match:", official ? official.name : "NOT FOUND");
for (const t of zec) {
  for (const u of meta.universe.filter((u: any) => u.tokens[0] === t.index)) {
    const book = await post({ type: "l2Book", coin: u.name });
    const [bids, asks] = book.levels;
    console.log(t.name, u.name, "pair", u.tokens, "bids", bids.slice(0, 3), "asks", asks.slice(0, 3));
  }
}
const perps = await post({ type: "meta" });
console.log("ZEC perp:", perps.universe.filter((u: any) => u.name === "ZEC"));
export {};
