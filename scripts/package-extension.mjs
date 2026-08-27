import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readProjectVersions } from "./versions.mjs";

export function listExtensionFiles(root) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const files = new Set(["manifest.json"]);

  if (existsSync(join(root, "LICENSE"))) files.add("LICENSE");

  if (manifest.action?.default_popup) {
    files.add(manifest.action.default_popup);
    const base = manifest.action.default_popup.replace(/\.html$/i, "");
    for (const ext of [".js", ".css"]) {
      const relative = `${base}${ext}`;
      if (existsSync(join(root, relative))) files.add(relative);
    }
  }

  for (const path of Object.values(manifest.action?.default_icon ?? {})) files.add(path);
  for (const path of Object.values(manifest.icons ?? {})) files.add(path);
  for (const script of manifest.content_scripts ?? []) {
    for (const path of [...(script.js ?? []), ...(script.css ?? [])]) files.add(path);
  }

  if (existsSync(join(root, "assets/logo.svg"))) files.add("assets/logo.svg");
  return [...files].sort();
}

export function packageExtension({ root, version, outDir = join(root, "dist") }) {
  mkdirSync(outDir, { recursive: true });
  const zipPath = join(outDir, `im-an-adult-${version}.zip`);
  const files = listExtensionFiles(root);
  // ZIP local headers reject timestamps before 1980. Cloud checkouts often
  // stamp files at the Unix epoch, so write a fixed valid date instead.
  const script = `
import zipfile, sys
out, *names = sys.argv[1:]
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for name in names:
        info = zipfile.ZipInfo(filename=name)
        info.date_time = (2026, 1, 1, 0, 0, 0)
        info.external_attr = 0o644 << 16
        with open(name, "rb") as fh:
            zf.writestr(info, fh.read())
`;
  const result = spawnSync("python3", ["-c", script, zipPath, ...files], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to write the extension zip");
  }
  return zipPath;
}

if (import.meta.main) {
  const root = process.cwd();
  const version = readProjectVersions(root).package;
  console.log(packageExtension({ root, version }));
}
