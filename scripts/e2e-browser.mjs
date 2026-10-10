// Browser checks for Phase 4 (reload, two tabs, cleared storage, Unit/HL down). Read-only: never signs.
// Needs playwright-core + its Chromium (installed outside the repo) and `next dev -p 3123`. Usage: node scripts/e2e-browser.mjs <fresh tm… address>
import { chromium } from "playwright-core";
const B = "http://localhost:3123", HL = "0x1f20B96A9fde5218ED05A212B2d23093100785c0";
const TM = process.argv[2];
const res = []; const ok = (n, c, extra = "") => { res.push(`${c ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`); };
const browser = await chromium.launch(); const ctx = await browser.newContext();
const errors = []; ctx.on("weberror", (e) => errors.push(String(e.error())));
const p = await ctx.newPage();
const waitText = (pg, t, ms = 20000) => pg.getByText(t).first().waitFor({ timeout: ms }).then(() => true, () => false);

// 1. /return live: browser CORS to Unit + HL, accounting
await p.goto(B + "/return");
ok("return: Unit fees fetched from browser (CORS)", await waitText(p, /Bridge fee/));
ok("return: balances accounted", await waitText(p, "All accounted for"));
const dest = p.locator("input").nth(2);
await dest.fill("textest1thdh90ttywp4tjf9ljc7q5u8sa564ggp9jt7yf");
ok("return: TEX destination refused", await waitText(p, /tex is not accepted/, 3000));
await dest.fill(TM); await p.getByRole("checkbox").check();
await p.getByRole("button", { name: /Verify and continue/ }).click();
ok("return: live route verified 3/3 in browser", await waitText(p, /3\/3 guardians verified/));
await p.reload();
ok("return: route survives reload", await waitText(p, /3\/3 guardians verified/));

// 2. pending send left by a closed tab -> outcome unknown in a second tab, after reload
const key = `return:v1:testnet:unit-live:${HL.toLowerCase()}`;
await p.evaluate(([k]) => { const r = JSON.parse(localStorage.getItem(k)); r.send = { token: "XZEC:0xc8e8047efa1400eb0b7b9bbee16b759d", amount: "0.1", destination: r.route.unitHlAddress, nonceFloor: Date.now(), state: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; localStorage.setItem(k, JSON.stringify(r)); }, [key]);
const p2 = await ctx.newPage(); await p2.goto(B + "/return");
ok("return: crash-pending send shows outcome unknown in 2nd tab", await waitText(p2, /Checking your send/));
ok("return: no send button while unknown", (await p2.getByRole("button", { name: /^Send / }).count()) === 0);
ok("return: accounting flags unknown funds", await waitText(p2, /unknown state/));
await p2.getByRole("button", { name: /Check now/ }).click();
ok("return: live reconcile keeps unknown before 10 min", await waitText(p2, /Not in the ledger yet/));
await p2.close();

// 3. cleared storage
await p.evaluate(() => localStorage.clear()); await p.reload();
ok("return: cleared storage -> clean page, still reads balances", await waitText(p, "All accounted for"));

// 4. provider failure: Unit down
await p.route(/hyperunit/, (r) => r.abort());
await p.reload();
ok("return: Unit down -> fee error shown, page alive", await waitText(p, /Unit fees unavailable/));
ok("return: Unit down -> balances still shown", await waitText(p, "Where your money is"));
await p.unroute(/hyperunit/);

// 5. HL down after first read -> stale, last state kept
await p.goto(B + "/trade");
ok("trade: live balances (read-only)", await waitText(p, /Account value/));
await p.route(/hyperliquid-testnet/, (r) => r.abort());
ok("trade: HL down -> stale banner, last state kept", await waitText(p, /Read failed \(showing last known state\)/, 25000) && await waitText(p, /Account value/, 1000));
await p.unroute(/hyperliquid-testnet/);

// 6. unknown order blocks new orders in two tabs; survives reload
await p.evaluate(([h]) => localStorage.setItem(`orders:testnet:${h.toLowerCase()}`, JSON.stringify([{ cloid: "0x" + "ab".repeat(16), network: "testnet", account: h, label: "BTC long open", asset: 3, isBuy: true, size: "0.0002", px: "1", reduceOnly: false, state: "unknown", error: "timeout", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: Date.now() }])), [HL]);
await p.reload(); const p3 = await ctx.newPage(); await p3.goto(B + "/trade");
ok("trade: unknown order banner after reload", await waitText(p, /not sure an order went through/));
ok("trade: same banner in 2nd tab", await waitText(p3, /not sure an order went through/));
await p3.close(); await p.evaluate(() => localStorage.clear());

// 7. /fund live lane + replay provider error
await p.goto(B + "/fund");
await p.getByRole("button", { name: /deposit address/ }).click();
ok("fund: live deposit address 3/3 from browser", await waitText(p, /3\/3 guardians verified/));
await p.reload();
ok("fund: record survives reload (status shown)", await waitText(p, /Bridge records/));
await p.evaluate(() => localStorage.clear());
await p.goto(B + "/fund"); await p.getByText("Developer options").click(); await p.locator("select").selectOption("provider_error");
await p.getByRole("button", { name: /deposit address/ }).click();
ok("fund: provider error -> no payment request, do-not-resend", await waitText(p, /send again/i));
ok("fund: replay lane labelled", await waitText(p, /Simulation mode/));

ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
await browser.close(); console.log(res.join("\n"));
