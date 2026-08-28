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
  window.dispatchEvent(new CustomEvent("__ima_settings__", {
    detail: { disableScrollEffects: true, enabled: ${enabled} },
  }));
</script>
<style>
  body { min-height: 600vh; }
  .scroll-effect {
    animation: reveal linear both;
    animation-timeline: view();
  }
  #opacity { opacity: 0; }
  #scale { transform: scale(0); }
  #scale-x { transform: scaleX(0); }
  #clip { clip-path: inset(100%); }
  #directional-clip { clip-path: inset(0 100% 0 0); }
  #scale-z {
    animation-name: reveal-from-scale-z;
    opacity: 1;
    transform: scaleZ(0);
  }
  #rotate-y { transform: rotateY(90deg); }
  #combined {
    animation-name: reveal-opacity, reveal-scale;
    animation-timeline: view(), view();
    opacity: 0;
    transform: scale(0);
  }
  #ordinary { animation: pulse 10s linear infinite; }
  @keyframes reveal {
    to { clip-path: inset(0%); opacity: 1; transform: scale(1); }
  }
  @keyframes reveal-from-scale-z {
    to { opacity: 0.5; transform: none; }
  }
  @keyframes reveal-opacity { to { opacity: 1; } }
  @keyframes reveal-scale { to { transform: none; } }
  @keyframes pulse { to { opacity: 0.75; } }
</style>
<div class="scroll-effect" id="opacity">Opacity reveal</div>
<div class="scroll-effect" id="scale">Scale reveal</div>
<div class="scroll-effect" id="scale-x">Single-axis scale reveal</div>
<div class="scroll-effect" id="clip">Clip reveal</div>
<div class="scroll-effect" id="directional-clip">Directional clip reveal</div>
<div class="scroll-effect" id="scale-z">Visible scaleZ effect</div>
<div class="scroll-effect" id="rotate-y">Edge-on rotation reveal</div>
<div class="scroll-effect" id="combined">Combined opacity and scale reveal</div>
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
    const scaleX = document.querySelector("#scale-x");
    const clip = document.querySelector("#clip");
    const directionalClip = document.querySelector("#directional-clip");
    const scaleZ = document.querySelector("#scale-z");
    const rotateY = document.querySelector("#rotate-y");
    const combined = document.querySelector("#combined");
    const shadowReveal = shadowRoot.querySelector(".reveal");
    document.querySelector("#result").textContent = JSON.stringify({
      clip: getComputedStyle(clip).clipPath,
      directionalClip: getComputedStyle(directionalClip).clipPath,
      opacity: getComputedStyle(opacity).opacity,
      combinedOpacity: getComputedStyle(combined).opacity,
      combinedTransform: getComputedStyle(combined).transform,
      ordinaryAnimations: document.querySelector("#ordinary").getAnimations().length,
      scale: getComputedStyle(scale).transform,
      scaleX: getComputedStyle(scaleX).transform,
      scaleZOpacity: getComputedStyle(scaleZ).opacity,
      rotateY: getComputedStyle(rotateY).transform,
      shadowAnimations: shadowReveal.getAnimations().length,
      shadowOpacity: getComputedStyle(shadowReveal).opacity,
      scrollAnimations:
        opacity.getAnimations().length +
        scale.getAnimations().length +
        scaleX.getAnimations().length +
        clip.getAnimations().length +
        directionalClip.getAnimations().length +
        scaleZ.getAnimations().length +
        rotateY.getAnimations().length +
        combined.getAnimations().length,
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
    assert.notEqual(result.scaleX, "matrix(0, 0, 0, 1, 0, 0)");
    assert.notEqual(result.clip, "inset(100%)");
    assert.notEqual(result.directionalClip, "inset(0px 100% 0px 0px)");
    assert.equal(result.scaleZOpacity, "1");
    assert.notEqual(
      result.rotateY,
      "matrix3d(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1)",
    );
    assert.equal(result.combinedOpacity, "1");
    assert.notEqual(result.combinedTransform, "matrix(0, 0, 0, 0, 0, 0)");
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

    assert.equal(result.scrollAnimations, 9);
    assert.equal(result.shadowAnimations, 1);
    assert.notEqual(result.waapiState, "idle");
    assert.equal(result.ordinaryAnimations, 1);
  },
);
