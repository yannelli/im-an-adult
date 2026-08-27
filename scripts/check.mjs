import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Manifest must use version 3");

const referencedFiles = [
  manifest.action.default_popup,
  ...Object.values(manifest.action.default_icon),
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((script) => [
    ...(script.js ?? []),
    ...(script.css ?? []),
  ]),
];

await Promise.all([...new Set(referencedFiles)].map((file) => access(file)));

for (const file of ["content-main.js", "content-isolated.js", "popup.js"]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}

console.log(`Checked manifest, ${new Set(referencedFiles).size} referenced files, and JavaScript syntax.`);
