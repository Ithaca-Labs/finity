import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoDir = resolve(appDir, "../..");
const outputPath = resolve(appDir, "public/downloads/finity-0.1.0.tar.gz");

mkdirSync(dirname(outputPath), { recursive: true });

const excludes = [
  "./.git",
  "./.pnpm-store",
  "./node_modules",
  "./**/node_modules",
  "./**/dist",
  "./**/.next",
  "./contracts/artifacts",
  "./contracts/cache",
  "./contracts/types",
  "./coverage",
  "./**/*.tsbuildinfo",
  "./apps/console/public/downloads",
  "./.env",
  "./.env.*",
];

const args = ["-czf", outputPath];
for (const pattern of excludes) args.push(`--exclude=${pattern}`);
args.push("-C", repoDir, ".");

execFileSync("tar", args, { stdio: "inherit" });
console.log(`Wrote ${outputPath}`);
