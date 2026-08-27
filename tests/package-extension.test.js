import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { listExtensionFiles, packageExtension } from "../scripts/package-extension.mjs";

const root = join(import.meta.dir, "..");

describe("package extension", () => {
  test("includes shipped extension files and omits sources and tooling", () => {
    const files = listExtensionFiles(root);
    expect(files).toContain("manifest.json");
    expect(files).toContain("popup.html");
    expect(files).toContain("popup.js");
    expect(files).toContain("popup.css");
    expect(files).toContain("content-main.js");
    expect(files).toContain("content-isolated.js");
    expect(files).toContain("content.css");
    expect(files).toContain("assets/logo.svg");
    expect(files).toContain("icons/icon-16.png");
    expect(files).toContain("LICENSE");
    expect(files).not.toContain("scripts/check.mjs");
    expect(files).not.toContain("package.json");
    expect(files).not.toContain("DESIGN.md");
  });

  test("writes a zip with manifest.json at the archive root", () => {
    const outDir = mkdtempSync(join(tmpdir(), "im-an-adult-zip-"));
    const zipPath = packageExtension({ root, version: "0.1.0", outDir });
    expect(zipPath.endsWith("im-an-adult-0.1.0.zip")).toBe(true);

    const listed = spawnSync("python3", ["-m", "zipfile", "-l", zipPath], { encoding: "utf8" });
    expect(listed.status).toBe(0);
    expect(listed.stdout).toMatch(/(^|\n)manifest\.json\b/);
    expect(listed.stdout).not.toMatch(/im-an-adult\/manifest\.json/);

    const raw = readFileSync(zipPath);
    expect(raw.subarray(0, 2).toString()).toBe("PK");
  });
});
