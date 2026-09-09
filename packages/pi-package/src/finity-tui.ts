import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

export type FinityAction = "refresh" | "mandate" | "services" | "withdraw" | "escalations" | "setup" | "revoke" | "kill";

export type FinityDashboardState = {
  loading?: boolean;
  connected: boolean;
  killSwitchActive: boolean;
  mandate?: {
    id: string;
    status: string;
    principal: string;
    broker: string;
    periodRemainingTinybar: string;
    periodLimitTinybar: string;
    lifetimeRemainingTinybar: string;
    lifetimeLimitTinybar: string;
    reservedTinybar: string;
    validUntil: string;
    allowedServices: string;
    allowedMethods: string;
  };
  broker?: {
    address: string;
    spendAccountId: string;
    balanceTinybar: string;
  };
  pendingEscalations: number;
  message?: string;
  error?: string;
};

export const FINITY_ACTIONS: Array<{ action: FinityAction; key: string; label: string; hint: string }> = [
  { action: "refresh", key: "r", label: "Refresh live state", hint: "Hedera + broker" },
  { action: "mandate", key: "m", label: "Inspect active mandate", hint: "limits + expiry" },
  { action: "services", key: "d", label: "View allowed services", hint: "mandate-scoped" },
  { action: "withdraw", key: "w", label: "Withdraw broker funds", hint: "to Ledger principal" },
  { action: "escalations", key: "e", label: "Review escalations", hint: "approve from Ledger" },
  { action: "setup", key: "s", label: "Run Ledger setup", hint: "genuine check + Key Ring" },
  { action: "revoke", key: "v", label: "Revoke active mandate", hint: "Ledger approval" },
  { action: "kill", key: "k", label: "Toggle purchase kill switch", hint: "broker emergency stop" },
];

export function formatTinybars(value: string | bigint | undefined): string {
  if (value === undefined) return "—";
  try {
    const tinybars = typeof value === "bigint" ? value : BigInt(value);
    const whole = tinybars / 100_000_000n;
    const fraction = (tinybars % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
    return `${whole}${fraction ? `.${fraction}` : ""} HBAR`;
  } catch {
    return "—";
  }
}

export function parseHbarToTinybars(value: string): string {
  const normalized = value.trim().replace(/\s*HBAR\s*$/i, "");
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(normalized)) {
    throw new Error("enter an HBAR amount with up to 8 decimal places");
  }
  const [whole = "", fraction = ""] = normalized.split(".");
  const tinybars = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
  if (tinybars <= 0n) throw new Error("withdrawal amount must be greater than 0 HBAR");
  return tinybars.toString();
}

export function formatAddress(value: string | undefined): string {
  if (!value) return "—";
  if (value.length <= 22) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export function formatUntil(value: string | undefined): string {
  if (!value) return "—";
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "—";
  try {
    return new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z";
  } catch {
    return "—";
  }
}

function progressBar(remaining: string, limit: string, width: number, theme: Theme): string {
  try {
    const max = BigInt(limit);
    const left = BigInt(remaining);
    if (max <= 0n) return theme.fg("dim", "—".repeat(Math.max(1, width)));
    const filled = Math.max(0, Math.min(width, Number((left * BigInt(width)) / max)));
    return theme.fg("success", "━".repeat(filled)) + theme.fg("borderMuted", "─".repeat(width - filled));
  } catch {
    return theme.fg("dim", "—".repeat(Math.max(1, width)));
  }
}

function padStyled(value: string, width: number): string {
  const truncated = truncateToWidth(value, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export class FinityControlCenter implements Component {
  private selectedIndex = 0;
  private state: FinityDashboardState;
  private busy = false;
  private readonly theme: Theme;
  private readonly onAction: (action: FinityAction) => Promise<void> | void;
  private readonly onCancel: () => void;

  constructor(theme: Theme, state: FinityDashboardState, onAction: (action: FinityAction) => Promise<void> | void, onCancel: () => void) {
    this.theme = theme;
    this.state = state;
    this.onAction = onAction;
    this.onCancel = onCancel;
  }

  setState(state: FinityDashboardState): void {
    this.state = state;
    this.invalidate();
  }

  render(width: number): string[] {
    const colors = this.theme;
    const inner = Math.max(18, width - 2);
    const line = (content = "") => colors.fg("border", "│") + padStyled(` ${content}`, inner) + colors.fg("border", "│");
    const top = colors.fg("borderAccent", `╭${"─".repeat(inner)}╮`);
    const bottom = colors.fg("borderAccent", `╰${"─".repeat(inner)}╯`);
    const mandate = this.state.mandate;
    const broker = this.state.broker;
    const statusColor = mandate?.status === "ACTIVE" ? "success" : mandate ? "warning" : "dim";
    const connection = this.state.connected ? colors.fg("success", "● ONLINE") : colors.fg("error", "● OFFLINE");
    const kill = this.state.killSwitchActive ? colors.fg("error", "KILL SWITCH ON") : colors.fg("success", "PURCHASES ARMED");
    const rows: string[] = [
      top,
      line(`${colors.fg("accent", "◆")} ${colors.bold(colors.fg("text", "FINITY"))} ${colors.fg("muted", "/ CONTROL CENTER")}     ${connection}  ${kill}`),
      line(colors.fg("dim", "Ledger-governed commerce · Hedera testnet")),
      line(),
      line(colors.fg("accent", "AUTHORITY")),
      line(mandate
        ? `${colors.fg(statusColor, `● ${mandate.status}`)}  ${colors.fg("text", formatAddress(mandate.id))}  ${colors.fg("dim", `expires ${formatUntil(mandate.validUntil)}`)}`
        : colors.fg("warning", "○ NO ACTIVE MANDATE  ·  run setup or create one")),
      line(mandate
        ? `${colors.fg("muted", "period left ")}${colors.fg("text", formatTinybars(mandate.periodRemainingTinybar))}  ${progressBar(mandate.periodRemainingTinybar, mandate.periodLimitTinybar, Math.min(18, Math.max(5, inner - 64)), colors)}`
        : colors.fg("dim", "period budget unavailable")),
      line(mandate
        ? `${colors.fg("muted", "lifetime left ")}${colors.fg("text", formatTinybars(mandate.lifetimeRemainingTinybar))}  ${progressBar(mandate.lifetimeRemainingTinybar, mandate.lifetimeLimitTinybar, Math.min(18, Math.max(5, inner - 64)), colors)}${colors.fg("dim", mandate.reservedTinybar !== "0" ? `  reserved ${formatTinybars(mandate.reservedTinybar)}` : "")}`
        : colors.fg("dim", "lifetime budget unavailable")),
      line(mandate ? `${colors.fg("muted", "principal ")}${colors.fg("text", formatAddress(mandate.principal))}` : ""),
      line(),
      line(colors.fg("accent", "BROKER")),
      line(broker
        ? `${colors.fg("muted", "balance ")}${colors.bold(colors.fg("text", formatTinybars(broker.balanceTinybar)))}  ${colors.fg("dim", `${broker.spendAccountId}  ${formatAddress(broker.address)}`)}`
        : colors.fg("dim", "broker account unavailable")),
      line(),
      line(`${colors.fg("accent", "ACTIONS")} ${this.state.pendingEscalations ? colors.fg("warning", `· ${this.state.pendingEscalations} pending`) : colors.fg("dim", "· clear")}`),
    ];

    const actionCell = (item: (typeof FINITY_ACTIONS)[number], index: number): string => {
      const selected = index === this.selectedIndex;
      const marker = selected ? colors.fg("accent", "›") : colors.fg("dim", " ");
      const key = colors.fg(selected ? "text" : "muted", `[${item.key}]`);
      const label = selected ? colors.bold(colors.fg("text", item.label)) : colors.fg("text", item.label);
      return `${marker} ${key} ${label}${colors.fg("dim", `  ${item.hint}`)}`;
    };
    if (inner >= 68) {
      const columnWidth = Math.floor((inner - 1) / 2);
      for (let index = 0; index < FINITY_ACTIONS.length; index += 2) {
        const left = padStyled(actionCell(FINITY_ACTIONS[index]!, index), columnWidth);
        const right = FINITY_ACTIONS[index + 1] ? padStyled(actionCell(FINITY_ACTIONS[index + 1]!, index + 1), columnWidth) : "";
        rows.push(line(`${left} ${right}`));
      }
    } else {
      for (const [index, item] of FINITY_ACTIONS.entries()) rows.push(line(actionCell(item, index)));
    }

    if (this.state.loading || this.busy) rows.push(line(colors.fg("accent", "… working")));
    if (this.state.error) rows.push(line(colors.fg("error", `! ${this.state.error}`)));
    if (this.state.message) rows.push(line(colors.fg("success", `✓ ${this.state.message}`)));
    rows.push(line(), line(colors.fg("dim", "↑↓ navigate   Enter select   r refresh   Esc close")), bottom);
    return rows.map((row) => truncateToWidth(row, width));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(FINITY_ACTIONS.length - 1, this.selectedIndex + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.selectedIndex = Math.min(FINITY_ACTIONS.length - 1, this.selectedIndex + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      void this.activate(FINITY_ACTIONS[this.selectedIndex]!.action);
      return;
    }
    const shortcut = data.toLowerCase();
    const item = FINITY_ACTIONS.find((candidate) => candidate.key === shortcut);
    if (item) void this.activate(item.action);
  }

  invalidate(): void {
    // Render is derived entirely from state.
  }

  private async activate(action: FinityAction): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.invalidate();
    try {
      await this.onAction(action);
    } finally {
      this.busy = false;
      this.invalidate();
    }
  }
}

export function finityHeader(theme: Theme, width: number): string[] {
  const wordmark = `${theme.fg("accent", "◆")} ${theme.bold(theme.fg("text", "FINITY"))}`;
  const descriptor = theme.fg("muted", "Ledger-governed commerce on Hedera");
  return ["", truncateToWidth(` ${wordmark}  ${descriptor}`, width), truncateToWidth(` ${theme.fg("dim", "authority first · payments bounded · credentials isolated")}`, width), ""];
}

export function finityFooter(theme: Theme, width: number): string[] {
  const left = `${theme.fg("accent", "FINITY")} ${theme.fg("dim", "· /finity control center")}`;
  const right = theme.fg("muted", "Esc close  ·  /help commands");
  const gap = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
  return [truncateToWidth(` ${left}${gap}${right}`, width)];
}
