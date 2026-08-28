// Brand asset generator for "I'm an Adult".
//
// Regenerates every SVG in icons/, assets/, store/ and rasterizes the PNGs
// the manifest and store listing use. Listing screenshots are 1280x800
// 24-bit PNG (no alpha) to match the Chrome Web Store upload rules.
// The committed SVGs are the design source of truth; this script exists
// so they can be rebuilt from scratch.
//
// Not wired into package.json on purpose: it needs two tools that are not
// project dependencies plus the IBM Plex fonts (OFL licensed):
//   bun add --no-save sharp opentype.js
//   PLEX_DIR=/path/to/ibm-plex-ttfs bun scripts/brand.mjs
// (PLEX_DIR defaults to /usr/share/fonts/truetype/ibm-plex, the Ubuntu
// fonts-ibm-plex package location. Wordmark text is outlined to paths, so
// the emitted SVGs and PNGs have no font dependency at all.)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";

const WT = fileURLToPath(new URL("..", import.meta.url));
const FONTDIR = process.env.PLEX_DIR ?? "/usr/share/fonts/truetype/ibm-plex";

function loadFont(file) {
  const b = readFileSync(join(FONTDIR, file));
  const f = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  // opentype's lazy glyph parsing can cache NaN coords when glyphs are first
  // touched mid-render; force-build every path in clean index order up front.
  for (let i = 0; i < f.glyphs.length; i++) void f.glyphs.get(i).path;
  return f;
}
const serifSemi = loadFont("IBMPlexSerif-SemiBold.ttf");
const serifItal = loadFont("IBMPlexSerif-MediumItalic.ttf");
const mono = loadFont("IBMPlexMono-Medium.ttf");

// ---- palette ----
const CREAM = "#F3F1E8";
const CREAM_DIM = "#E4E0CF";   // scrollbar tracks, quiet panels
const INK = "#17231D";
const INK_ON_DARK = "#e9e7db"; // matches popup.css --ink in dark mode
const INK_SOFT = "#4A544D";    // secondary text
const PINE = "#1B4A33";        // icon field
const PINE_DEEP = "#123525";   // switch thumb on the pine site panel
const PINE_TEXT = "#2E5B43";   // green asides
const TERRA = "#EB5C3F";       // the period
const HAIRLINE = "rgb(23 35 29 / 16%)";

// per-glyph layout: opentype's Font.getPath emits NaN x-coords for some
// (font, size, position) combos, so accumulate advances + kerning ourselves.
function layout(font, text, fs) {
  const scale = fs / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const runs = [];
  let cx = 0;
  for (let i = 0; i < glyphs.length; i++) {
    runs.push({ glyph: glyphs[i], x: cx });
    cx += glyphs[i].advanceWidth * scale;
    if (i + 1 < glyphs.length) cx += font.getKerningValue(glyphs[i], glyphs[i + 1]) * scale;
  }
  return { runs, width: cx };
}
// serialize a glyph outline ourselves: scale font units + flip y onto the
// baseline. (opentype's getPath/toPathData emits NaN moveTos under some
// call histories, so we don't trust it.)
function glyphD(glyph, gx, baseline, fs, upem) {
  const s = fs / upem;
  const fx = (v) => +(gx + v * s).toFixed(2);
  const fy = (v) => +(baseline - v * s).toFixed(2);
  let d = "";
  for (const c of glyph.path.commands) {
    if (c.type === "M") d += `M${fx(c.x)} ${fy(c.y)}`;
    else if (c.type === "L") d += `L${fx(c.x)} ${fy(c.y)}`;
    else if (c.type === "Q") d += `Q${fx(c.x1)} ${fy(c.y1)} ${fx(c.x)} ${fy(c.y)}`;
    else if (c.type === "C") d += `C${fx(c.x1)} ${fy(c.y1)} ${fx(c.x2)} ${fy(c.y2)} ${fx(c.x)} ${fy(c.y)}`;
    else if (c.type === "Z") d += "Z";
  }
  if (d.includes("NaN")) throw new Error(`NaN in glyph ${glyph.name}`);
  return d;
}
function textPath(font, text, x, baseline, fs, fill, tracking = 0) {
  const { runs } = layout(font, text, fs);
  let out = "";
  for (let i = 0; i < runs.length; i++) {
    const d = glyphD(runs[i].glyph, x + runs[i].x + i * tracking, baseline, fs, font.unitsPerEm);
    if (d) out += `<path d="${d}" fill="${fill}"/>`;
  }
  return out;
}
function adv(font, text, fs) {
  return layout(font, text, fs).width;
}
// spaced-out caps for mono microtype (manual letterspacing)
function trackedText(font, text, x, baseline, fs, fill, tracking) {
  const { runs, width } = layout(font, text, fs);
  return {
    svg: textPath(font, text, x, baseline, fs, fill, tracking),
    width: width + Math.max(0, runs.length - 1) * tracking,
  };
}

// ---- the mark: free-scroll double arrow (+ optional period) ----
// drawn on a 128 grid, returned as a group. dot=true adds the terracotta period.
function mark128(dot = true) {
  const arrow = `
  <g fill="none" stroke="${CREAM}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
    <path d="M52 31v66"/>
    <path d="M36 47 52 31 68 47"/>
    <path d="M36 81 52 97 68 81"/>
  </g>`;
  const period = dot ? `<circle cx="93" cy="92" r="11.5" fill="${TERRA}"/>` : "";
  return arrow + period;
}

function iconSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="30" fill="${PINE}"/>
  <rect x="5" y="5" width="118" height="118" rx="25" fill="none" stroke="${CREAM}" stroke-opacity=".14" stroke-width="2"/>
  ${mark128(true)}
</svg>
`;
}

// hand-tuned small cut: solid filled double-arrow (strokes smudge at 16px), bigger dot
function icon16SVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="3.5" fill="${PINE}"/>
  <path fill="${CREAM}" d="M6.5 1.5 10.5 6h-2.6v4h2.6L6.5 14.5 2.5 10h2.6V6H2.5Z"/>
  <circle cx="12.9" cy="12.4" r="2.1" fill="${TERRA}"/>
</svg>
`;
}

// ---- lockup: mark tile (no dot) + "I'm an Adult" + terracotta period ----
function logoSVG() {
  const fs = 46;
  const name = "I’m an Adult";
  const nameW = adv(serifSemi, name, fs);
  const dotW = adv(serifSemi, ".", fs);
  const tile = 56, pad = 2, gap = 18;
  const textX = pad + tile + gap;
  const H = 60;
  const capH = (serifSemi.tables.os2.sCapHeight / serifSemi.unitsPerEm) * fs;
  const baseline = Math.round(pad + tile / 2 + capH / 2) - 1;
  const W = Math.ceil(textX + nameW + dotW + pad + 2);
  const s = tile / 128;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="I’m an Adult.">
  <style>
    @media (prefers-color-scheme: dark) {
      path[fill="${INK}"] { fill: ${INK_ON_DARK}; }
    }
  </style>
  <g transform="translate(${pad} ${pad})">
    <rect width="${tile}" height="${tile}" rx="${Math.round(30 * s)}" fill="${PINE}"/>
    <g transform="scale(${s})">${mark128(true)}</g>
  </g>
  ${textPath(serifSemi, name, textX, baseline, fs, INK)}
  ${textPath(serifSemi, ".", textX + nameW, baseline, fs, TERRA)}
</svg>
`;
}

// ---- scrollbar element for promo art ----
function scrollbar(x, y, w, h, thumbY, thumbH) {
  const r = w / 2;
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${CREAM_DIM}"/>
  <rect x="${x}" y="${thumbY}" width="${w}" height="${thumbH}" rx="${r}" fill="${TERRA}"/>`;
}

// ---- banner 1400x560 ----
function bannerSVG() {
  const name = "I’m an Adult";
  const hfs = 148;
  const nameW = adv(serifSemi, name, hfs);
  const hx = 84, hbase = 318;
  const sub = "Let me scroll";
  const sfs = 56;
  const subW = adv(serifItal, sub, sfs);
  const sbase = 408;
  const folio = trackedText(mono, "A CHROME EXTENSION FOR GROWN-UPS", 84, 92, 17, INK_SOFT, 6);
  const folioR = trackedText(mono, "TAKE BACK SCROLLING", 0, 92, 17, INK_SOFT, 6);
  const folioRx = 1276 - folioR.width;
  const mk = 64, mks = mk / 128;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 560">
  <rect width="1400" height="560" fill="${CREAM}"/>
  ${folio.svg}
  ${trackedText(mono, "TAKE BACK SCROLLING", folioRx, 92, 17, INK_SOFT, 6).svg}
  <rect x="84" y="116" width="1192" height="2" fill="${INK}" opacity=".22"/>
  ${textPath(serifSemi, name, hx, hbase, hfs, INK)}
  ${textPath(serifSemi, ".", hx + nameW, hbase, hfs, TERRA)}
  ${textPath(serifItal, sub, hx + 6, sbase, sfs, "#2E5B43")}
  ${textPath(serifItal, ".", hx + 6 + subW, sbase, sfs, TERRA)}
  <rect x="84" y="464" width="1192" height="2" fill="${INK}" opacity=".22"/>
  <g transform="translate(84 484)">
    <rect width="${mk}" height="${mk}" rx="${30 * mks}" fill="${PINE}"/>
    <g transform="scale(${mks})">${mark128(true)}</g>
  </g>
  ${trackedText(mono, "BLOCKS SCROLL-JACKING · REMOVES SCROLL EFFECTS · PAUSES AUTOPLAY", 172, 522, 15, INK_SOFT, 4).svg}
  ${scrollbar(1332, 24, 26, 512, 86, 132)}
</svg>
`;
}

// ---- tile 440x280 ----
function tileSVG() {
  const name = "I’m an Adult";
  const hfs = 47;
  const nameW = adv(serifSemi, name, hfs);
  const sub = "Let me scroll";
  const sfs = 23;
  const subW = adv(serifItal, sub, sfs);
  const mk = 62, mks = mk / 128;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 280">
  <rect width="440" height="280" fill="${CREAM}"/>
  <g transform="translate(36 40)">
    <rect width="${mk}" height="${mk}" rx="${30 * mks}" fill="${PINE}"/>
    <g transform="scale(${mks})">${mark128(true)}</g>
  </g>
  ${textPath(serifSemi, name, 36, 172, hfs, INK)}
  ${textPath(serifSemi, ".", 36 + nameW, 172, hfs, TERRA)}
  ${textPath(serifItal, sub, 38, 212, sfs, INK_SOFT)}
  ${textPath(serifItal, ".", 38 + subW, 212, sfs, TERRA)}
  ${scrollbar(398, 20, 14, 240, 48, 64)}
</svg>
`;
}

// ---- store listing screenshots (1280x800, 24-bit PNG, no alpha) ----
// Chrome Web Store: 1–5 shots, 1280x800 or 640x400, JPEG or 24-bit PNG.
// These are full-bleed editorial posters that show the actual popup
// language and controls, sized to stay readable when the store
// downscales them to 640x400.

function withPeriod(font, text, x, baseline, fs, fill) {
  const w = adv(font, text, fs);
  return textPath(font, text, x, baseline, fs, fill)
    + textPath(font, ".", x + w, baseline, fs, TERRA);
}

function folioPair(left, right, y, rightEdge = 1196) {
  const L = trackedText(mono, left, 80, y, 16, INK_SOFT, 5);
  const R = trackedText(mono, right, 0, y, 16, INK_SOFT, 5);
  return L.svg + trackedText(mono, right, rightEdge - R.width, y, 16, INK_SOFT, 5).svg;
}

function rule(x, y, w) {
  return `<rect x="${x}" y="${y}" width="${w}" height="2" fill="${INK}" opacity=".22"/>`;
}

function shotShell({ folioL, folioR, scrollbarY = 24, scrollbarH = 752 } = {}) {
  return `<rect width="1280" height="800" fill="${CREAM}"/>
  ${folioPair(folioL, folioR, 84)}
  ${rule(80, 110, 1116)}
  ${scrollbar(1238, scrollbarY, 22, scrollbarH, 118, 176)}`;
}

function switchAt(x, y, on, { invert = false, s = 1 } = {}) {
  const w = 40 * s, h = 22 * s, r = 5 * s, tw = 14 * s, pad = 3 * s;
  if (invert && on) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${CREAM}"/>
    <rect x="${x + w - pad - tw}" y="${y + pad}" width="${tw}" height="${tw}" rx="${3 * s}" fill="${PINE_DEEP}"/>`;
  }
  if (on) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${PINE}"/>
    <rect x="${x + w - pad - tw}" y="${y + pad}" width="${tw}" height="${tw}" rx="${3 * s}" fill="${CREAM}"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${INK_SOFT}" stroke-width="${Math.max(1, s)}"/>
  <rect x="${x + pad}" y="${y + pad}" width="${tw}" height="${tw}" rx="${3 * s}" fill="${INK_SOFT}"/>`;
}

function siteVerdict(x, y, w, h, hostname, state) {
  const active = state === "active";
  const paused = state === "paused";
  const fill = active ? PINE : CREAM_DIM;
  const stroke = active ? PINE : HAIRLINE;
  const hostFill = active ? CREAM : INK;
  const overFill = active ? "rgb(243 241 232 / 65%)" : INK_SOFT;
  const status = active ? "Under your control" : paused ? "Doing whatever it wants" : "Chrome keeps its own pages off-limits";
  const statusFill = active ? "rgb(243 241 232 / 85%)" : TERRA;
  const sw = 40 * 1.8;
  const sh = 22 * 1.8;
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}"/>
  ${trackedText(mono, "THIS SITE", x + 28, y + 48, 12, overFill, 3).svg}
  ${textPath(mono, hostname, x + 28, y + 96, 28, hostFill)}
  ${withPeriod(serifItal, status, x + 28, y + 136, 20, statusFill)}
  ${switchAt(x + w - 28 - sw, y + (h - sh) / 2, active, { invert: active, s: 1.8 })}`;
}

function settingCard(x, y, w, h, title, sub, on) {
  const sw = 40 * 1.7;
  const sh = 22 * 1.7;
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${CREAM_DIM}" stroke="${HAIRLINE}"/>
  ${textPath(serifSemi, title, x + 28, y + 48, 28, INK)}
  ${textPath(serifItal, sub, x + 28, y + 84, 18, INK_SOFT)}
  ${switchAt(x + w - 28 - sw, y + (h - sh) / 2, on, { s: 1.7 })}`;
}

function wrapWords(font, text, fs, maxW) {
  const lines = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && adv(font, next, fs) > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function popupMock() {
  // Toolbar popup at the real 340px width, using the popup's labels and
  // helper copy. Scaled by the caller so type survives 640x400 downscale.
  const W = 340, H = 500;
  const row = (y, title, sub, on, { rule = false, h = 62 } = {}) => {
    const lines = wrapWords(serifItal, sub, 11, 248);
    return `
    ${rule ? `<rect x="16" y="${y}" width="308" height="1" fill="${HAIRLINE}"/>` : ""}
    ${textPath(serifSemi, title, 16, y + 20, 13, INK)}
    ${lines.map((line, i) => textPath(serifItal, line, 16, y + 36 + i * 13, 11, INK_SOFT)).join("")}
    ${switchAt(284, y + (h - 22) / 2, on)}`;
  };
  return { w: W, h: H, svg: `
  <rect width="${W}" height="${H}" rx="10" fill="${CREAM}" stroke="${INK}" stroke-opacity=".18"/>
  <g transform="translate(16 16)">
    <rect width="28" height="28" rx="7" fill="${PINE}"/>
    <g transform="scale(${28 / 128})">${mark128(true)}</g>
  </g>
  ${textPath(serifSemi, "I’m an Adult", 52, 38, 16, INK)}
  ${textPath(serifSemi, ".", 52 + adv(serifSemi, "I’m an Adult", 16), 38, 16, TERRA)}
  ${withPeriod(serifItal, "Let me scroll", 16, 62, 13, PINE_TEXT)}
  <rect x="16" y="74" width="308" height="1" fill="${INK}"/>
  <rect x="16" y="77" width="308" height="1" fill="${INK}"/>
  <g transform="translate(16 90)">
    <rect width="308" height="72" rx="8" fill="${PINE}"/>
    ${trackedText(mono, "THIS SITE", 14, 18, 9, "rgb(243 241 232 / 65%)", 2).svg}
    ${textPath(mono, "example.com", 14, 40, 14, CREAM)}
    ${withPeriod(serifItal, "Under your control", 14, 58, 12, "rgb(243 241 232 / 85%)")}
    ${switchAt(254, 25, true, { invert: true })}
  </g>
  ${trackedText(mono, "SCROLLING", 16, 186, 9, INK_SOFT, 2).svg}
  <rect x="92" y="182" width="232" height="1" fill="${HAIRLINE}"/>
  ${row(196, "Block scroll hijacking", "Pages can’t cancel or capture wheel and touch input", true)}
  ${row(258, "Disable scroll effects", "No smooth scrolling, snap points, or scroll-driven animation", true, { rule: true })}
  ${trackedText(mono, "WHILE WE’RE AT IT", 16, 340, 9, INK_SOFT, 2).svg}
  <rect x="148" y="336" width="176" height="1" fill="${HAIRLINE}"/>
  ${row(350, "Disable animated cursors", "Uses normal pointers and hides cursor followers", false, { h: 54 })}
  ${row(404, "Block autoplay", "Media waits until you press play", false, { rule: true, h: 54 })}
  <rect x="16" y="462" width="308" height="1" fill="${HAIRLINE}"/>
  ${textPath(serifItal, "Preferences apply on every site.", 16, 478, 10, INK_SOFT)}
  ${textPath(serifItal, "The switch up top only speaks for this one.", 16, 492, 10, INK_SOFT)}
` };
}

function screenshotHeroSVG() {
  const name = "I’m an Adult";
  const hfs = 118;
  const nameW = adv(serifSemi, name, hfs);
  const sub = "Let me scroll";
  const sfs = 50;
  const subW = adv(serifItal, sub, sfs);
  const mk = 56, mks = mk / 128;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800">
  ${shotShell({ folioL: "A CHROME EXTENSION FOR GROWN-UPS", folioR: "01  TAKE BACK SCROLLING" })}
  ${textPath(serifSemi, name, 80, 360, hfs, INK)}
  ${textPath(serifSemi, ".", 80 + nameW, 360, hfs, TERRA)}
  ${textPath(serifItal, sub, 84, 454, sfs, PINE_TEXT)}
  ${textPath(serifItal, ".", 84 + subW, 454, sfs, TERRA)}
  ${rule(80, 540, 1116)}
  <g transform="translate(80 612)">
    <rect width="${mk}" height="${mk}" rx="${30 * mks}" fill="${PINE}"/>
    <g transform="scale(${mks})">${mark128(true)}</g>
  </g>
  ${trackedText(mono, "BLOCKS SCROLL-JACKING  ·  REMOVES SCROLL EFFECTS  ·  PAUSES AUTOPLAY", 156, 646, 15, INK_SOFT, 3).svg}
</svg>
`;
}

function screenshotPopupSVG() {
  const popup = popupMock();
  const scale = 1.42;
  const pw = popup.w * scale;
  const ph = popup.h * scale;
  const px = 1280 - 80 - 22 - pw - 16;
  const py = Math.round((800 - ph) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800">
  ${shotShell({ folioL: "THE TOOLBAR POPUP", folioR: "02  YOUR CONTROLS" })}
  ${withPeriod(serifSemi, "Your panel", 80, 280, 72, INK)}
  ${withPeriod(serifItal, "Pause a site. Flip a switch", 84, 360, 28, PINE_TEXT)}
  ${textPath(serifItal, "The rest of the web stays under control", 84, 404, 22, INK_SOFT)}
  <g transform="translate(${px} ${py}) scale(${scale})">${popup.svg}</g>
</svg>
`;
}

function screenshotScrollingSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800">
  ${shotShell({ folioL: "SCROLLING", folioR: "03  THE WHEEL IS YOURS" })}
  ${withPeriod(serifSemi, "The wheel is yours", 80, 230, 64, INK)}
  ${withPeriod(serifItal, "Pages don’t get to cancel it", 84, 292, 26, PINE_TEXT)}
  ${settingCard(80, 360, 1116, 150, "Block scroll hijacking", "Pages can’t cancel or capture wheel and touch input", true)}
  ${settingCard(80, 534, 1116, 150, "Disable scroll effects", "No smooth scrolling, snap points, or scroll-driven animation", true)}
</svg>
`;
}

function screenshotPerSiteSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800">
  ${shotShell({ folioL: "THIS SITE", folioR: "04  PAUSE ONE SITE" })}
  ${withPeriod(serifSemi, "Pause one site", 80, 230, 64, INK)}
  ${withPeriod(serifItal, "The switch up top only speaks for this one", 84, 292, 26, PINE_TEXT)}
  ${siteVerdict(80, 360, 546, 280, "news.example", "active")}
  ${siteVerdict(650, 360, 546, 280, "maps.example", "paused")}
</svg>
`;
}

function screenshotExtrasSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800">
  ${shotShell({ folioL: "WHILE WE’RE AT IT", folioR: "05  OPTIONAL EXTRAS" })}
  ${withPeriod(serifSemi, "Cursors. Autoplay", 80, 230, 64, INK)}
  ${withPeriod(serifItal, "Off until you want them", 84, 292, 26, PINE_TEXT)}
  ${settingCard(80, 360, 1116, 150, "Disable animated cursors", "Uses normal pointers and hides cursor followers", false)}
  ${settingCard(80, 534, 1116, 150, "Block autoplay", "Media waits until you press play", false)}
</svg>
`;
}

// ---- emit ----
mkdirSync(join(WT, "assets"), { recursive: true });
mkdirSync(join(WT, "store"), { recursive: true });

const files = {
  "icons/icon.svg": iconSVG(),
  "icons/icon-16.svg": icon16SVG(),
  "assets/logo.svg": logoSVG(),
  "store/banner-1400x560.svg": bannerSVG(),
  "store/tile-440x280.svg": tileSVG(),
  "store/screenshot-1280x800-01-hero.svg": screenshotHeroSVG(),
  "store/screenshot-1280x800-02-popup.svg": screenshotPopupSVG(),
  "store/screenshot-1280x800-03-scrolling.svg": screenshotScrollingSVG(),
  "store/screenshot-1280x800-04-per-site.svg": screenshotPerSiteSVG(),
  "store/screenshot-1280x800-05-extras.svg": screenshotExtrasSVG(),
};
for (const [rel, svg] of Object.entries(files)) writeFileSync(join(WT, rel), svg);

async function png(svgRel, outRel, w, h, { flatten } = {}) {
  const buf = readFileSync(join(WT, svgRel));
  const d = 72 * (w / parseFloat(String(buf).match(/viewBox="0 0 (\d+(?:\.\d+)?)/)[1]));
  let img = sharp(buf, { density: Math.max(d, 1) }).resize(w, h);
  // Listing screenshots must be 24-bit (no alpha). Icons keep transparency
  // so they still work on light and dark toolbar chips. Banner and tile
  // stay on the historical raster path so a rebuild does not rewrite them.
  if (flatten) img = img.flatten({ background: flatten });
  await img.png().toFile(join(WT, outRel));
}

const paper = { r: 0xf3, g: 0xf1, b: 0xe8 };
await png("icons/icon.svg", "icons/icon-128.png", 128, 128);
await png("icons/icon.svg", "icons/icon-48.png", 48, 48);
await png("icons/icon.svg", "icons/icon-32.png", 32, 32);
await png("icons/icon-16.svg", "icons/icon-16.png", 16, 16);
await png("store/banner-1400x560.svg", "store/banner-1400x560.png", 1400, 560);
await png("store/tile-440x280.svg", "store/tile-440x280.png", 440, 280);
for (const shot of [
  "screenshot-1280x800-01-hero",
  "screenshot-1280x800-02-popup",
  "screenshot-1280x800-03-scrolling",
  "screenshot-1280x800-04-per-site",
  "screenshot-1280x800-05-extras",
]) {
  await png(`store/${shot}.svg`, `store/${shot}.png`, 1280, 800, { flatten: paper });
}

console.log("brand assets regenerated");
