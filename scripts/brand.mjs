// Brand asset generator for "I'm an Adult".
//
// Regenerates every SVG in icons/, assets/, store/ and rasterizes the PNGs
// the manifest and store listing use. The committed SVGs are the design
// source of truth; this script exists so they can be rebuilt from scratch.
//
// Not wired into package.json on purpose: it needs two tools that are not
// project dependencies plus the IBM Plex fonts (OFL licensed):
//   npm i --no-save sharp opentype.js
//   PLEX_DIR=/path/to/ibm-plex-ttfs node scripts/brand.mjs
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
const INK_SOFT = "#4A544D";    // secondary text
const PINE = "#1B4A33";        // icon field
const TERRA = "#EB5C3F";       // the period

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

// ---- emit ----
mkdirSync(join(WT, "assets"), { recursive: true });
mkdirSync(join(WT, "store"), { recursive: true });

const files = {
  "icons/icon.svg": iconSVG(),
  "icons/icon-16.svg": icon16SVG(),
  "assets/logo.svg": logoSVG(),
  "store/banner-1400x560.svg": bannerSVG(),
  "store/tile-440x280.svg": tileSVG(),
};
for (const [rel, svg] of Object.entries(files)) writeFileSync(join(WT, rel), svg);

async function png(svgRel, outRel, w, h) {
  const buf = readFileSync(join(WT, svgRel));
  const d = 72 * (w / parseFloat(String(buf).match(/viewBox="0 0 (\d+(?:\.\d+)?)/)[1]));
  await sharp(buf, { density: Math.max(d, 1) }).resize(w, h).png().toFile(join(WT, outRel));
}

await png("icons/icon.svg", "icons/icon-128.png", 128, 128);
await png("icons/icon.svg", "icons/icon-48.png", 48, 48);
await png("icons/icon.svg", "icons/icon-32.png", 32, 32);
await png("icons/icon-16.svg", "icons/icon-16.png", 16, 16);
await png("store/banner-1400x560.svg", "store/banner-1400x560.png", 1400, 560);
await png("store/tile-440x280.svg", "store/tile-440x280.png", 440, 280);

console.log("brand assets regenerated");
