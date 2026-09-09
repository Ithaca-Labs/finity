import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FinityControlCenter, formatTinybars, parseHbarToTinybars } from "./finity-tui.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

describe("Finity control-center formatting", () => {
  it("formats tinybars without floating-point drift", () => {
    expect(formatTinybars("5000000")).toBe("0.05 HBAR");
    expect(formatTinybars("5000000000")).toBe("50 HBAR");
    expect(formatTinybars("not-a-number")).toBe("—");
  });

  it("parses human HBAR input into integer tinybars", () => {
    expect(parseHbarToTinybars("1.25 HBAR")).toBe("125000000");
    expect(parseHbarToTinybars("0.00000001")).toBe("1");
    expect(() => parseHbarToTinybars("1.123456789")).toThrow();
    expect(() => parseHbarToTinybars("0")).toThrow();
  });

  it("renders a bounded panel and routes keyboard actions", async () => {
    const actions: string[] = [];
    let cancelled = false;
    const panel = new FinityControlCenter(theme, {
      connected: true,
      killSwitchActive: false,
      pendingEscalations: 0,
      mandate: {
        id: `0x${"11".repeat(32)}`, status: "ACTIVE", principal: `0x${"22".repeat(20)}`, broker: `0x${"33".repeat(20)}`,
        periodRemainingTinybar: "95000000", periodLimitTinybar: "100000000", lifetimeRemainingTinybar: "950000000", lifetimeLimitTinybar: "1000000000",
        reservedTinybar: "0", validUntil: "1800000000", allowedServices: "hello-weather@1", allowedMethods: "weather.current",
      },
      broker: { address: `0x${"33".repeat(20)}`, spendAccountId: "0.0.123", balanceTinybar: "500000000" },
    }, async (action) => { actions.push(action); }, () => { cancelled = true; });

    const rows = panel.render(80);
    expect(rows.every((row) => visibleWidth(row) <= 80)).toBe(true);
    panel.handleInput("w");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(actions).toEqual(["withdraw"]);
    panel.handleInput("\u001b");
    expect(cancelled).toBe(true);
  });
});
