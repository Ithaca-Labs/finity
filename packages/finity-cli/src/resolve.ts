import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function finityHome(): string {
  return process.env.FINITY_HOME ?? join(homedir(), ".finity");
}

export function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2]!.trim();
    values[match[1]!] = value.replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
  }
  return values;
}

/** Loads repo-local configuration without overwriting variables supplied by the shell. */
export async function loadDotEnv(filePath = join(process.cwd(), ".env")): Promise<void> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const [name, value] of Object.entries(parseDotEnv(source))) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

/** Resolves an installed workspace package's root directory from its package.json export. */
export function resolvePackageRoot(specifier: string): string {
  const packageJsonUrl = import.meta.resolve(`${specifier}/package.json`);
  return dirname(fileURLToPath(packageJsonUrl));
}

export function resolvePiPackageRoot(): string {
  return resolvePackageRoot("@finity/pi-package");
}

export function resolveFinitydBin(): string {
  return join(resolvePackageRoot("@finity/finityd"), "dist", "daemon.js");
}

export type FinitydHealthCheck = (baseUrl: string, token: string) => Promise<boolean>;

const defaultHealthCheck: FinitydHealthCheck = async (baseUrl, token) => {
  try {
    const response = await fetch(`${baseUrl}/v1/health`, { headers: { authorization: `Bearer ${token}` } });
    return response.ok;
  } catch {
    return false;
  }
};

/** True only if finityd's runtime info file exists *and* it actually answers a health check. */
export async function isFinitydRunning(runtimeInfoPath = join(finityHome(), "finityd.runtime.json"), healthCheck: FinitydHealthCheck = defaultHealthCheck): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(runtimeInfoPath, "utf8");
  } catch {
    return false;
  }
  let parsed: { baseUrl?: unknown; token?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed.baseUrl !== "string" || typeof parsed.token !== "string") return false;
  return healthCheck(parsed.baseUrl, parsed.token);
}
