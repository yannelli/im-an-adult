import { lintPrTitle } from "./conventional.mjs";

const title = process.env.PR_TITLE ?? process.argv.slice(2).join(" ");
const result = lintPrTitle(title);
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
