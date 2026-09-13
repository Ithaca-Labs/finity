import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FINITYD_RUNTIME_VERSION } from "@therick/finityd";
import { ensureWalletPassEnvironment, loadFinitydRuntimeInfo } from "@therick/pi-package";

type ManagedProcess = { label: string; child: ChildProcess };

const projectRoot = process.cwd();
const owned: ManagedProcess[] = [];
let shuttingDown = false;

async function loadDotEnv(): Promise<void> {
  let source: string;
  try {
    source = await readFile(join(projectRoot, ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]!] !== undefined) continue;
    const value = match[2]!.trim();
    process.env[match[1]!] = value.replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function healthy(url: string, headers?: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(label: string, check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become healthy within 15 seconds`);
}

function logOutput(label: string, chunk: Buffer): void {
  for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) console.log(`[${label}] ${line}`);
}

function start(label: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env): ChildProcess {
  const childEnv = { ...env };
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => logOutput(label, chunk));
  child.stderr?.on("data", (chunk: Buffer) => logOutput(label, chunk));
  child.once("exit", (code, signal) => {
    if (!shuttingDown && code !== 0) console.error(`[${label}] exited with ${signal ?? `code ${code}`}`);
  });
  owned.push({ label, child });
  return child;
}

async function startProvider(label: string, script: string, healthUrl: string): Promise<void> {
  if (await healthy(healthUrl)) {
    console.log(`${label} already healthy at ${healthUrl}`);
    return;
  }
  const providerEnv = { ...process.env };
  delete providerEnv.WALLET_PASS;
  start(label, "pnpm", [script], providerEnv);
  await waitFor(label, () => healthy(healthUrl));
  console.log(`${label} healthy at ${healthUrl}`);
}

async function daemonState(): Promise<"missing" | "healthy" | "stale"> {
  try {
    const runtime = await loadFinitydRuntimeInfo();
    if (!(await healthy(`${runtime.baseUrl}/v1/health`, { authorization: `Bearer ${runtime.token}` }))) return "missing";
    return runtime.version === FINITYD_RUNTIME_VERSION ? "healthy" : "stale";
  } catch {
    return "missing";
  }
}

async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of owned) child.kill("SIGTERM");
  await Promise.all(owned.map(({ child }) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("close", () => resolve());
    setTimeout(resolve, 3_000);
  })));
  process.exit(code);
}

async function main(): Promise<void> {
  await loadDotEnv();
  const weatherUrl = required("FINITY_PROVIDER_A_URL");
  const summarizeUrl = required("FINITY_PROVIDER_B_URL");
  const existingDaemon = await daemonState();
  if (existingDaemon === "stale") {
    throw new Error("an older healthy finityd is running; stop it once, then rerun pnpm dev:stack");
  }
  await startProvider("weather", "provider:weather", `${weatherUrl}/health`);
  await startProvider("summarize", "provider:summarize", `${summarizeUrl}/health`);

  if (existingDaemon === "missing") {
    await ensureWalletPassEnvironment();
    start("finityd", process.execPath, [join(projectRoot, "packages/finityd/dist/daemon.js")]);
    await waitFor("finityd", async () => (await daemonState()) === "healthy");
  }

  const runtime = await loadFinitydRuntimeInfo();
  console.log(`finityd healthy at ${runtime.baseUrl}`);
  console.log("Stack is ready. Keep this terminal open; press Ctrl-C to stop processes started here.");
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await shutdown(1);
});
