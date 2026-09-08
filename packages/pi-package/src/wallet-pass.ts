import { spawn } from "node:child_process";

export async function walletPassFromEnvironmentOrKeychain(): Promise<string> {
  if (process.env.WALLET_PASS) return process.env.WALLET_PASS;
  if (process.platform !== "darwin") return "";
  return new Promise((resolve) => {
    const child = spawn("security", ["find-generic-password", "-a", "default", "-s", "ledger-wallet-cli", "-w"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", () => resolve(""));
    child.once("close", (code) => resolve(code === 0 ? Buffer.concat(chunks).toString("utf8").trim() : ""));
  });
}

export async function ensureWalletPassEnvironment(): Promise<string> {
  const pass = await walletPassFromEnvironmentOrKeychain();
  if (!pass) throw new Error("Ledger Key Ring password is unavailable; store it in macOS Keychain as service ledger-wallet-cli, account default");
  process.env.WALLET_PASS = pass;
  return pass;
}
