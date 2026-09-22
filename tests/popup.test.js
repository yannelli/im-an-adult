import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const html = readFileSync(join(root, "popup.html"), "utf8");
const css = readFileSync(join(root, "popup.css"), "utf8");
const javascript = readFileSync(join(root, "popup.js"), "utf8");

describe("popup experience", () => {
  test("labels every switch and announces save state", () => {
    const switches = [...html.matchAll(/<input[\s\S]*?role="switch"[\s\S]*?>/g)];

    expect(switches).toHaveLength(5);
    for (const [markup] of switches) {
      expect(markup).toContain('aria-label="');
    }
    expect(html).toContain('id="save-status" aria-live="polite"');
  });

  test("offers direct site status, grouped counts, and default restoration", () => {
    expect(javascript).toContain('label: "Protection on"');
    expect(javascript).toContain('label: "Protection paused"');
    expect(javascript).toContain("group-count");
    expect(html).toContain('id="reset-settings"');
    expect(javascript).toContain("Defaults restored");
  });

  test("keeps the visual system free of glow and edge-rail treatments", () => {
    expect(css).not.toMatch(/box-shadow|text-shadow|border-left/i);
  });
});
