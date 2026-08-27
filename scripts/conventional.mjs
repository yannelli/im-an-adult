export const COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const SUBJECT =
  /^(?<type>feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\((?<scope>[^)\s]+)\))?(?<breaking>!)?:\s+(?<description>.+)$/;
const REVERT_SUBJECT = /^Revert "(.+)"$/;
const TYPE_BUMP = { feat: "minor", fix: "patch", perf: "patch", revert: "patch" };
const BUMP_RANK = { major: 3, minor: 2, patch: 1 };
const SECTION_FOR_TYPE = {
  feat: "Added",
  fix: "Fixed",
  perf: "Changed",
  refactor: "Changed",
  revert: "Fixed",
};
const SECTION_ORDER = ["Added", "Changed", "Fixed", "Removed"];

export const CHANGELOG_HEADER = `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`;

export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid semver version: ${version}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function nextVersion(current, bump) {
  const version = parseSemver(current);
  if (bump === "major") return `${version.major + 1}.0.0`;
  if (bump === "minor") return `${version.major}.${version.minor + 1}.0`;
  if (bump === "patch") return `${version.major}.${version.minor}.${version.patch + 1}`;
  throw new Error(`Invalid bump: ${bump}`);
}

export function latestVersionTag(tags) {
  const versions = tags
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .map((tag) => tag.slice(1))
    .sort(compareSemver);
  return versions.length ? `v${versions.at(-1)}` : null;
}

export function parseCommit(message) {
  if (!message) return null;
  const trimmed = message.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return null;

  const [subjectLine, ...rest] = trimmed.split("\n");
  const subject = subjectLine.trim();
  if (/^Merge\s/.test(subject)) return null;

  let groups = subject.match(SUBJECT)?.groups;
  if (!groups) {
    const reverted = subject.match(REVERT_SUBJECT);
    if (!reverted) return null;
    groups = { type: "revert", scope: null, breaking: "", description: reverted[1] };
  }

  const body = rest.join("\n");
  return {
    type: groups.type,
    scope: groups.scope ?? null,
    breaking: Boolean(groups.breaking) || /^BREAKING[ -]CHANGE:/m.test(body),
    description: groups.description.trim(),
  };
}

export function isIgnoredCommit(message) {
  const subject = message?.trim().split("\n")[0] ?? "";
  if (/^Merge\s/.test(subject)) return true;
  const parsed = parseCommit(message);
  return parsed?.type === "chore" && parsed.scope === "release";
}

export function bumpFromCommits(messages) {
  let best = null;
  for (const message of messages) {
    if (isIgnoredCommit(message)) continue;
    const parsed = parseCommit(message);
    if (!parsed) continue;
    const bump = parsed.breaking ? "major" : TYPE_BUMP[parsed.type];
    if (!bump) continue;
    if (!best || BUMP_RANK[bump] > BUMP_RANK[best]) best = bump;
  }
  return best;
}

export function lintCommitMessage(message) {
  if (isIgnoredCommit(message ?? "")) return { ok: true };
  if (parseCommit(message ?? "")) return { ok: true };
  const subject = message?.trim().split("\n")[0] || "(empty)";
  return {
    ok: false,
    error: `Commit message must use the Conventional Commits standard, for example:\n  feat: add per-site pause\n  fix(popup): restore contrast\nGot: ${subject}`,
  };
}

export function lintPrTitle(title) {
  const trimmed = title?.trim() ?? "";
  const withoutNumber = trimmed.replace(/\s+\(#\d+\)$/, "");
  if (parseCommit(withoutNumber) || parseCommit(trimmed)) return { ok: true };
  return {
    ok: false,
    error: `Pull request title must be a Conventional Commit, for example:\n  feat: add per-site pause\n  fix(popup): restore contrast\nGot: ${trimmed || "(empty)"}`,
  };
}

export function formatDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function renderReleaseNotes({ version, date, commits }) {
  const sections = new Map();
  for (const commit of commits) {
    const parsed = typeof commit === "string" ? parseCommit(commit) : commit;
    if (!parsed) continue;
    const heading = parsed.breaking ? "Changed" : SECTION_FOR_TYPE[parsed.type];
    if (!heading) continue;
    const items = sections.get(heading) ?? [];
    items.push(parsed.description);
    sections.set(heading, items);
  }

  let notes = `## [${version}] - ${date}\n`;
  for (const heading of SECTION_ORDER) {
    const items = [...new Set(sections.get(heading) ?? [])];
    if (!items.length) continue;
    notes += `\n### ${heading}\n\n`;
    for (const item of items) notes += `- ${item}\n`;
  }
  return notes;
}

export function prependChangelog(existing, notes) {
  const text = existing.trimStart();
  const match = text.match(/^## \[/m);
  const header = match ? text.slice(0, match.index).replace(/\s*$/, "\n\n") : `${CHANGELOG_HEADER.trim()}\n\n`;
  const rest = match ? text.slice(match.index).replace(/^\n+/, "") : "";
  return `${header}${notes.trim()}\n\n${rest}`.replace(/\n+$/, "\n");
}

export function extractChangelogSection(changelog, version) {
  const start = changelog.indexOf(`## [${version}]`);
  if (start === -1) return "";
  const from = changelog.slice(start);
  const next = from.search(/\n## \[/);
  return (next === -1 ? from : from.slice(0, next)).trim();
}
