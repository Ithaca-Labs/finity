#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { ensureWalletPassEnvironment } from "@finity/pi-package";
import { finityHome, isFinitydRunning, loadDotEnv, resolveFinitydBin, resolvePiPackageRoot } from "../resolve.js";

const FINITY_SYSTEM_PROMPT = [
  "You are the Finity Buyer Agent. You have no keys, no passwords, and no wallet access.",
  "Every purchase runs through finityd, which enforces a mandate the Principal signed on their Ledger.",
  "Use finity_buy directly for purchase requests; it reuses valid setup and interactively provisions only missing broker or mandate state.",
  "Never ask the user for a private key, password, seed phrase, or account credentials.",
].join(" ");

async function startFinitydDetached(): Promise<void> {
  await ensureWalletPassEnvironment();
  const daemonPath = resolveFinitydBin();
  const child = spawn(process.execPath, [daemonPath], { detached: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await isFinitydRunning()) return;
  }
  throw new Error("finityd did not report healthy within 5 seconds; run `finity broker` in a separate terminal to see its output.");
}

async function main(): Promise<void> {
  await loadDotEnv();
  const args = process.argv.slice(2);

  if (args[0] === "broker") {
    await ensureWalletPassEnvironment();
    const daemonPath = resolveFinitydBin();
    const child = spawn(process.execPath, [daemonPath], { stdio: "inherit" });
    child.on("exit", (code) => {
      process.exitCode = code ?? 0;
    });
    return;
  }

  let hasBrokerBundle = true;
  try {
    await access(`${finityHome()}/bundles/broker.enc`);
  } catch {
    hasBrokerBundle = false;
  }
  if (hasBrokerBundle && !(await isFinitydRunning())) {
    try {
      console.error("finityd is not running; starting it now...");
      await startFinitydDetached();
    } catch (error) {
      console.error(`finityd will start during the next purchase: ${(error as Error).message}`);
    }
  }

  const piRoot = resolvePiPackageRoot();
  const result = spawnSync("pi", ["--no-builtin-tools", "-e", piRoot, "--use-theme", "finity", "--system-prompt", FINITY_SYSTEM_PROMPT, ...args], {
    stdio: "inherit",
    env: { ...process.env, FINITY_DAEMON_PATH: resolveFinitydBin() },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
