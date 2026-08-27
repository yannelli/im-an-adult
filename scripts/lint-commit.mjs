import { lintCommitMessage } from "./conventional.mjs";

const message = process.argv.slice(2).join(" ") || process.env.COMMIT_MESSAGE || "";
const result = lintCommitMessage(message);
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
