import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bumpFromCommits,
  extractChangelogSection,
  formatDate,
  isIgnoredCommit,
  latestVersionTag,
  nextVersion,
  parseCommit,
  prependChangelog,
  renderReleaseNotes,
} from "./conventional.mjs";
import { packageExtension } from "./package-extension.mjs";
import { assertVersionsMatch, readProjectVersions, writeProjectVersions } from "./versions.mjs";

const BOT_LOGINS = new Set(["github-actions", "semantic-release-bot", "dependabot", "renovate"]);

export function assertHumanActor(user) {
  if (!user) {
    throw new Error("A personal RELEASE_TOKEN is required. Do not use the default GitHub Actions token.");
  }
  const login = user.login ?? "";
  const bot = user.type === "Bot" || /\[bot\]/i.test(login) || BOT_LOGINS.has(login);
  if (bot) {
    throw new Error("Refusing to release with a bot identity. Set RELEASE_TOKEN to a personal access token.");
  }
}

export function planRelease({ currentVersion, tags, commits, date }) {
  const bump = bumpFromCommits(commits);
  if (!bump) {
    return latestVersionTag(tags) ? { action: "skip" } : { action: "bootstrap", version: currentVersion };
  }

  const lastTag = latestVersionTag(tags);
  const version = nextVersion(lastTag ? lastTag.slice(1) : currentVersion, bump);
  const releasable = commits.filter((message) => !isIgnoredCommit(message)).map(parseCommit).filter(Boolean);
  return {
    action: "release",
    version,
    bump,
    notes: renderReleaseNotes({
      version,
      date: date ?? formatDate(),
      commits: releasable,
    }),
  };
}

export function applyRelease({ root, version, notes, packageZip = true }) {
  writeProjectVersions(root, version);
  const existing = existsSync(join(root, "CHANGELOG.md"))
    ? readFileSync(join(root, "CHANGELOG.md"), "utf8")
    : "# Changelog\n\n";
  writeFileSync(join(root, "CHANGELOG.md"), prependChangelog(existing, notes));
  return { zip: packageZip ? packageExtension({ root, version }) : null };
}

function run(command, args, { env = process.env, cwd = process.cwd(), input } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd, env, input });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function gitIdentity(actor) {
  const name = actor.name?.trim() || actor.login;
  const email =
    actor.email?.trim() ||
    (actor.id ? `${actor.id}+${actor.login}@users.noreply.github.com` : `${actor.login}@users.noreply.github.com`);
  if (/\[bot\]/i.test(name) || /\[bot\]/i.test(email)) {
    throw new Error("Refusing to commit a release as a bot identity.");
  }
  return { name, email };
}

function listTags() {
  const stdout = run("git", ["tag", "--list", "v*"]);
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function listCommits(sinceTag) {
  const range = sinceTag ? `${sinceTag}..HEAD` : "HEAD";
  const stdout = run("git", ["log", range, "--pretty=format:%B%x1e"]);
  return stdout.split("\x1e").map((message) => message.trim()).filter(Boolean);
}

function fetchActor(token) {
  const stdout = run("gh", ["api", "user"], {
    env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
  });
  return JSON.parse(stdout);
}

function configureGit(actor) {
  const { name, email } = gitIdentity(actor);
  run("git", ["config", "user.name", name]);
  run("git", ["config", "user.email", email]);
}

function publishGithubRelease({ token, version, notes, zipPath }) {
  const dir = mkdtempSync(join(tmpdir(), "im-an-adult-notes-"));
  const notesFile = join(dir, "notes.md");
  writeFileSync(notesFile, `${notes.trim()}\n`);
  try {
    run("gh", ["release", "create", `v${version}`, zipPath, "--title", `v${version}`, "--notes-file", notesFile], {
      env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function runRelease({
  root = process.cwd(),
  token = process.env.RELEASE_TOKEN || process.env.GH_TOKEN,
  dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1",
} = {}) {
  const versions = readProjectVersions(root);
  assertVersionsMatch(versions.package, versions.manifest);

  run("git", ["fetch", "--tags", "--force"]);
  const tags = listTags();
  const lastTag = latestVersionTag(tags);
  const commits = listCommits(lastTag);
  const plan = planRelease({ currentVersion: versions.package, tags, commits });

  if (plan.action === "skip") {
    console.log("No releasable conventional commits; skipping.");
    return plan;
  }

  if (dryRun) {
    console.log(`Dry run: would ${plan.action} v${plan.version}`);
    if (plan.notes) console.log(plan.notes);
    return plan;
  }

  if (!token) {
    throw new Error(
      "RELEASE_TOKEN is required for publishing. Create a personal access token and add it as the RELEASE_TOKEN repository secret. Do not use the default GitHub Actions token.",
    );
  }

  const actor = fetchActor(token);
  assertHumanActor(actor);
  configureGit(actor);

  if (plan.action === "bootstrap") {
    const changelog = existsSync(join(root, "CHANGELOG.md")) ? readFileSync(join(root, "CHANGELOG.md"), "utf8") : "";
    const notes = extractChangelogSection(changelog, plan.version) || `## [${plan.version}]\n`;
    const zip = packageExtension({ root, version: plan.version });
    run("git", ["tag", "-a", `v${plan.version}`, "-m", `v${plan.version}`]);
    run("git", ["push", "origin", `v${plan.version}`]);
    publishGithubRelease({ token, version: plan.version, notes, zipPath: zip });
    console.log(`Bootstrapped v${plan.version}`);
    return plan;
  }

  const { zip } = applyRelease({ root, version: plan.version, notes: plan.notes });
  run("git", ["add", "package.json", "manifest.json", "CHANGELOG.md"]);
  run("git", ["commit", "-m", `chore(release): ${plan.version} [skip ci]`]);
  run("git", ["tag", "-a", `v${plan.version}`, "-m", `v${plan.version}`]);
  const branch = process.env.GITHUB_REF_NAME || "main";
  run("git", ["push", "origin", `HEAD:${branch}`]);
  run("git", ["push", "origin", `v${plan.version}`]);
  publishGithubRelease({ token, version: plan.version, notes: plan.notes, zipPath: zip });
  console.log(`Released v${plan.version}`);
  return plan;
}

if (import.meta.main) {
  runRelease().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
