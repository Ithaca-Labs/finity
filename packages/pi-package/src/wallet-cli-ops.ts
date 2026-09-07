import { spawn } from "node:child_process";

/**
 * Runs a wallet-cli subcommand that needs the device and/or an interactive
 * terminal (genuine-check, ring init), with stdio inherited so the CLI's own
 * prompts and the device's on-screen confirmation flow work normally.
 * WALLET_PASS, if `ring init` needs it, must already be set in this
 * process's environment by the user - this never reads, sets, or echoes it.
 */
function runInteractive(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("wallet-cli", args, { stdio: "inherit", env: process.env });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

export function genuineCheck(): Promise<boolean> {
  return runInteractive(["genuine-check"]);
}

export function ringInit(name: string): Promise<boolean> {
  return runInteractive(["ring", "init", "--name", name]);
}
