import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const storeDir = join(import.meta.dir, "../store");

// Chrome Web Store listing screenshots:
// https://developer.chrome.com/docs/webstore/images
const ALLOWED_SIZES = new Set(["1280x800", "640x400"]);
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

function inspectListingImage(path) {
  const buf = readFileSync(path);
  const png = readPngHeader(buf);
  if (png) return { path, ...png };
  const jpeg = readJpegSize(buf);
  if (jpeg) return { path, ...jpeg };
  return { path, format: "unknown" };
}

describe("Chrome Web Store screenshots", () => {
  const files = listingScreenshots();

  test("provides between 1 and 5 listing screenshots", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.length).toBeLessThanOrEqual(5);
  });

  test("each screenshot is 1280x800 or 640x400 JPEG or 24-bit PNG without alpha", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const image = inspectListingImage(file);
      expect(ALLOWED_SIZES.has(`${image.width}x${image.height}`), file).toBe(true);

      if (image.format === "png") {
        expect(image.bitDepth, file).toBe(8);
        // 2 = truecolor RGB. 6 would be RGBA (alpha is rejected by the store).
        expect(image.colorType, file).toBe(2);
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
