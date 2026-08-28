import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const storeDir = join(import.meta.dir, "../store");

// Chrome Web Store listing screenshots:
// https://developer.chrome.com/docs/webstore/images
const ALLOWED_SIZES = new Set(["1280x800", "640x400"]);
const EXPECTED_SHOTS = [
  "screenshot-1280x800-01-hero.png",
  "screenshot-1280x800-02-popup.png",
  "screenshot-1280x800-03-scrolling.png",
  "screenshot-1280x800-04-per-site.png",
  "screenshot-1280x800-05-extras.png",
];
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);

function listingScreenshots() {
  return readdirSync(storeDir)
    .filter((name) => /^screenshot-.*\.(png|jpe?g)$/i.test(name))
    .sort()
    .map((name) => join(storeDir, name));
}

function readPngHeader(buf) {
  if (buf.length < 29 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const type = buf.subarray(12, 16).toString("ascii");
  if (type !== "IHDR") return null;
  return {
    format: "png",
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
}

function readJpegSize(buf) {
  if (buf.length < 4 || !buf.subarray(0, 3).equals(JPEG_SIG)) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    // SOF0 / SOF1 / SOF2
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        format: "jpeg",
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
        components: buf[offset + 9],
      };
    }
    offset += 2 + length;
  }
  return null;
}

function pngHasTransparency(buf) {
  const header = readPngHeader(buf);
  if (!header) return false;
  if (header.colorType === 4 || header.colorType === 6) return true;
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "tRNS") return true;
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return false;
}

function inspectListingImage(path) {
  const buf = readFileSync(path);
  const png = readPngHeader(buf);
  if (png) return { path, buf, ...png };
  const jpeg = readJpegSize(buf);
  if (jpeg) return { path, buf, ...jpeg };
  return { path, format: "unknown" };
}

describe("Chrome Web Store screenshots", () => {
  const files = listingScreenshots();

  test("provides the five 1280x800 listing screenshots", () => {
    expect(files.map((file) => file.slice(storeDir.length + 1))).toEqual(EXPECTED_SHOTS);
  });

  test("each screenshot is 1280x800 or 640x400 JPEG or 24-bit PNG without alpha", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const image = inspectListingImage(file);
      expect(ALLOWED_SIZES.has(`${image.width}x${image.height}`), file).toBe(true);
      expect(`${image.width}x${image.height}`, file).toBe("1280x800");

      if (image.format === "png") {
        expect(image.bitDepth, file).toBe(8);
        // 2 = truecolor RGB. 6 would be RGBA (alpha is rejected by the store).
        expect(image.colorType, file).toBe(2);
        expect(pngHasTransparency(image.buf), file).toBe(false);
      } else if (image.format === "jpeg") {
        expect(image.components, file).toBe(3);
      } else {
        expect(image.format).toBe("png or jpeg");
      }
    }
  });

  test("each screenshot has a matching SVG source in store/", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const svg = file.replace(/\.(png|jpe?g)$/i, ".svg");
      expect(readFileSync(svg, "utf8")).toMatch(/^<svg /);
    }
  });
});
