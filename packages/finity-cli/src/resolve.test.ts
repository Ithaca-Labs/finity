import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isFinitydRunning, resolveFinitydBin, resolvePiPackageRoot } from "./resolve.js";

describe("resolvePiPackageRoot / resolveFinitydBin", () => {
  it("resolve to real paths in the actually-installed workspace packages", () => {
    const piRoot = resolvePiPackageRoot();
    expect(existsSync(join(piRoot, "package.json"))).toBe(true);
    expect(existsSync(join(piRoot, "skills", "finity-buyer", "SKILL.md"))).toBe(true);

    const finitydBin = resolveFinitydBin();
    expect(finitydBin.endsWith(join("dist", "daemon.js"))).toBe(true);
  });
});

describe("isFinitydRunning", () => {
  it("is false when no runtime info file exists", async () => {
    expect(await isFinitydRunning("/nonexistent/finityd.runtime.json")).toBe(false);
  });

  it("is false when the file is malformed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finity-cli-runtime-"));
    const path = join(dir, "finityd.runtime.json");
    try {
      writeFileSync(path, "not json");
      expect(await isFinitydRunning(path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is false when the health check fails, even with a well-formed file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finity-cli-runtime-"));
    const path = join(dir, "finityd.runtime.json");
    try {
      writeFileSync(path, JSON.stringify({ baseUrl: "http://127.0.0.1:1", token: "tok" }));
      expect(await isFinitydRunning(path, async () => false)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is true when the file is well-formed and the health check passes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finity-cli-runtime-"));
    const path = join(dir, "finityd.runtime.json");
    try {
      writeFileSync(path, JSON.stringify({ baseUrl: "http://127.0.0.1:4000", token: "tok" }));
      let seenArgs: [string, string] | undefined;
      const result = await isFinitydRunning(path, async (baseUrl, token) => {
        seenArgs = [baseUrl, token];
        return true;
      });
      expect(result).toBe(true);
      expect(seenArgs).toEqual(["http://127.0.0.1:4000", "tok"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
