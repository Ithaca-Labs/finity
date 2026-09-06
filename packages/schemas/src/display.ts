export const HBAR_TINYBARS_PER_HBAR = 100_000_000n;

function formatHbar(amount: string): string {
  const value = BigInt(amount);
  const major = value / HBAR_TINYBARS_PER_HBAR;
  const minor = (value % HBAR_TINYBARS_PER_HBAR).toString().padStart(8, "0");
  const compactMinor = minor.replace(/0+$/, "");
  const displayMinor = compactMinor.length < 2 ? compactMinor.padEnd(2, "0") : compactMinor;
  return `${major.toString()}.${displayMinor} HBAR`;
}

export function formatDisplay(amount: string, asset: string): string {
  return asset === "HBAR" ? formatHbar(amount) : `${amount} ${asset}`;
}

export function formatDuration(seconds: string): string {
  const value = BigInt(seconds);
  if (value % 3600n === 0n) return `${value / 3600n}h`;
  return `${value}s`;
}

export function formatPeriodDisplay(amount: string, asset: string, periodSeconds: string): string {
  return `${formatDisplay(amount, asset)} per ${formatDuration(periodSeconds)}`;
}

export function formatUntilDisplay(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  if (!Number.isFinite(date.getTime())) throw new RangeError("validUntil is not a valid UNIX timestamp");
  const iso = date.toISOString();
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

