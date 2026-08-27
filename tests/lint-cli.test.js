import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function run(script, { argv = [], env = {} } = {}) {
  return spawnSync("bun", [join(root, "scripts", script), ...argv], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("lint CLIs", () => {
  test("lint-commit reads a message from argv", () => {
    const ok = run("lint-commit.mjs", { argv: ["feat: add pause"] });
    expect(ok.status).toBe(0);
    const bad = run("lint-commit.mjs", { argv: ["fixed stuff"] });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/conventional commit/i);
  });

  test("lint-pr-title reads PR_TITLE and allows a pull number suffix", () => {
    const ok = run("lint-pr-title.mjs", { env: { PR_TITLE: "ci: add release pipeline (#6)" } });
    expect(ok.status).toBe(0);
    const bad = run("lint-pr-title.mjs", { env: { PR_TITLE: "WIP pipeline" } });
    expect(bad.status).toBe(1);
  });
});
