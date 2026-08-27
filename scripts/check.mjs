import { readFile, access } from "node:fs/promises";

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

const extraFiles = ["assets/logo.svg", "icons/icon.svg", "icons/icon-16.svg"];
await Promise.all([...new Set([...referencedFiles, ...extraFiles])].map((file) => access(file)));

const transpiler = new Bun.Transpiler({ loader: "js" });
for (const file of ["content-main.js", "content-isolated.js", "popup.js"]) {
  transpiler.transformSync(await Bun.file(file).text());
}

console.log(`Checked manifest, ${new Set(referencedFiles).size} referenced files, and JavaScript syntax.`);
