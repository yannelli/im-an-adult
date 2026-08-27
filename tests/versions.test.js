import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertVersionsMatch,
  readProjectVersions,
  writeProjectVersions,
} from "../scripts/versions.mjs";

function fixture(version = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "im-an-adult-versions-"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "im-an-adult", version }, null, 2)}\n`);
  writeFileSync(
    join(root, "manifest.json"),
    `${JSON.stringify({ manifest_version: 3, name: "I'm an Adult", version }, null, 2)}\n`,
  );
  return root;
}

describe("project versions", () => {
  test("reads matching package and manifest versions", () => {
    const root = fixture("0.1.0");
    expect(readProjectVersions(root)).toEqual({ package: "0.1.0", manifest: "0.1.0" });
  });

  test("writes the same version to package.json and manifest.json", () => {
    const root = fixture("0.1.0");
    writeProjectVersions(root, "0.2.0");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    expect(pkg.version).toBe("0.2.0");
    expect(manifest.version).toBe("0.2.0");
    expect(manifest.manifest_version).toBe(3);
  });

  test("rejects mismatched or invalid versions", () => {
    expect(() => assertVersionsMatch("0.1.0", "0.1.1")).toThrow(/mismatch/i);
    expect(() => assertVersionsMatch("0.1.0-beta.1", "0.1.0-beta.1")).toThrow(/semver/i);
    expect(() => writeProjectVersions(mkdtempSync(join(tmpdir(), "bad-")), "1.0")).toThrow();
  });
});
