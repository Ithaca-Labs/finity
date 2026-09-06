import { mkdir, writeFile } from "node:fs/promises";
import { POLICY_HASH } from "../dist/index.js";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/POLICY_HASH", import.meta.url), `${POLICY_HASH}\n`, "utf8");

