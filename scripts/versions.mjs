import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSemver } from "./conventional.mjs";

export function assertVersionsMatch(packageVersion, manifestVersion) {
  if (packageVersion !== manifestVersion) {
    throw new Error(`Version mismatch: package.json is ${packageVersion}, manifest.json is ${manifestVersion}`);
  }
  parseSemver(packageVersion);
}

export function readProjectVersions(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  return { package: pkg.version, manifest: manifest.version };
}

export function writeProjectVersions(root, version) {
  parseSemver(version);
  const pkgPath = join(root, "package.json");
  const manifestPath = join(root, "manifest.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  pkg.version = version;
  manifest.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
