import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const chrome = ["google-chrome", "chromium", "chromium-browser"].find(
  (command) =>
    spawnSync("sh", ["-c", `command -v ${command}`], {
      stdio: "ignore",
    }).status === 0,
);

function runFixture(enabled) {
  const directory = mkdtempSync(join(tmpdir(), "ima-scroll-effects-"));
  const contentScript = new URL("../content-main.js", import.meta.url);
  copyFileSync(contentScript, join(directory, "content-main.js"));
  writeFileSync(
    join(directory, "fixture.html"),
    `<!doctype html>
<meta charset="utf-8">
<script src="content-main.js"></script>
<script>
  const settingsChannel = new MessageChannel();
  window.postMessage("__ima_settings_port__", "*", [settingsChannel.port2]);
  settingsChannel.port1.postMessage({
    disableScrollEffects: true,
    enabled: ${enabled},
  });
</script>
<style>
  body { min-height: 600vh; }
  .scroll-effect {
    animation: reveal linear both;
    animation-timeline: view();
  }
  #opacity { opacity: 0; }
  #scale { transform: scale(0); }
  #clip { clip-path: inset(100%); }
  #ordinary { animation: pulse 10s linear infinite; }
  @keyframes reveal {
    to { clip-path: inset(0%); opacity: 1; transform: scale(1); }
  }
  @keyframes pulse { to { opacity: 0.75; } }
</style>
<div class="scroll-effect" id="opacity">Opacity reveal</div>
<div class="scroll-effect" id="scale">Scale reveal</div>
<div class="scroll-effect" id="clip">Clip reveal</div>
<div id="ordinary">Ordinary animation</div>
<div id="waapi">WAAPI scroll animation</div>
<div id="shadow-host"></div>
<output id="result">pending</output>
<script>
  const waapi = document.querySelector("#waapi").animate(
    [{ opacity: 1 }, { opacity: 0.5 }],
    {
      duration: 1,
      fill: "both",
      timeline: new ScrollTimeline({ source: document.scrollingElement }),
    },
  );
  const shadowRoot = document.querySelector("#shadow-host").attachShadow({
    mode: "open",
  });
  shadowRoot.innerHTML =
    '<div class="reveal">Constructed stylesheet reveal</div>';
  const shadowSheet = new CSSStyleSheet();
  shadowSheet.replaceSync(
    '.reveal { animation: shadow-reveal linear both; animation-timeline: view(); margin-top: 400vh; opacity: 0; } @keyframes shadow-reveal { to { opacity: 1; } }',
  );
  setTimeout(() => shadowRoot.adoptedStyleSheets.push(shadowSheet), 50);

  setTimeout(() => {
    const opacity = document.querySelector("#opacity");
    const scale = document.querySelector("#scale");
    const clip = document.querySelector("#clip");
    const shadowReveal = shadowRoot.querySelector(".reveal");
    document.querySelector("#result").textContent = JSON.stringify({
      clip: getComputedStyle(clip).clipPath,
      opacity: getComputedStyle(opacity).opacity,
      ordinaryAnimations: document.querySelector("#ordinary").getAnimations().length,
      scale: getComputedStyle(scale).transform,
      shadowAnimations: shadowReveal.getAnimations().length,
      shadowOpacity: getComputedStyle(shadowReveal).opacity,
      scrollAnimations:
        opacity.getAnimations().length +
        scale.getAnimations().length +
        clip.getAnimations().length,
      waapiState: waapi.playState,
    });
  }, 150);
</script>`,
  );

  try {
    const result = spawnSync(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--virtual-time-budget=1000",
        "--dump-dom",
        `file://${join(directory, "fixture.html")}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const match = /<output id="result">([^<]+)<\/output>/.exec(result.stdout);
    assert.ok(match, "Chrome did not render the fixture result");
    return JSON.parse(match[1]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test(
  "real Chrome settles native scroll reveals and preserves ordinary animation",
  { skip: !chrome },
  () => {
    const result = runFixture(true);

    assert.equal(result.opacity, "1");
    assert.notEqual(result.scale, "matrix(0, 0, 0, 0, 0, 0)");
    assert.notEqual(result.clip, "inset(100%)");
    assert.equal(result.scrollAnimations, 0);
    assert.equal(result.shadowAnimations, 0);
    assert.equal(result.shadowOpacity, "1");
    assert.equal(result.waapiState, "idle");
    assert.equal(result.ordinaryAnimations, 1);
  },
);

test(
  "real Chrome leaves native scroll animations running on paused sites",
  { skip: !chrome },
  () => {
    const result = runFixture(false);

    assert.equal(result.scrollAnimations, 3);
    assert.equal(result.shadowAnimations, 1);
    assert.notEqual(result.waapiState, "idle");
    assert.equal(result.ordinaryAnimations, 1);
  },
);
