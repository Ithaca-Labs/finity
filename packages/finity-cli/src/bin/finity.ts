#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { isFinitydRunning, loadDotEnv, resolveFinitydBin, resolvePiPackageRoot } from "../resolve.js";

const FINITY_SYSTEM_PROMPT = [
  "You are the Finity Buyer Agent. You have no keys, no passwords, and no wallet access.",
  "Every purchase runs through finityd, which enforces a mandate the Principal signed on their Ledger.",
  "Use the finity_discover, finity_quote, and finity_purchase tools in that order for any purchase.",
  "Never ask the user for a private key, password, seed phrase, or account credentials.",
].join(" ");

async function startFinitydDetached(): Promise<void> {
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
    const daemonPath = resolveFinitydBin();
    const child = spawn(process.execPath, [daemonPath], { stdio: "inherit" });
    child.on("exit", (code) => {
      process.exitCode = code ?? 0;
    });
    return;
  }

  if (!(await isFinitydRunning())) {
    console.error("finityd is not running; starting it now...");
    await startFinitydDetached();
  }

  const piRoot = resolvePiPackageRoot();
  const result = spawnSync("pi", ["--no-builtin-tools", "-e", piRoot, "--system-prompt", FINITY_SYSTEM_PROMPT, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
