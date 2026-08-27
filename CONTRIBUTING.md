# Contributing

Changes land through pull requests against `main`. Local work needs [Bun](https://bun.sh).

```sh
bun run check
bun test
```

Do not bump `package.json` or `manifest.json` yourself. Version numbers are cut by the release workflow.

## Standard

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>[optional scope][optional !]: <description>
```

Types:

| Type | Use |
| --- | --- |
| `feat` | A user-visible addition |
| `fix` | A bug fix |
| `perf` | A performance improvement |
| `docs` | Documentation only |
| `style` | Formatting, no behavior change |
| `refactor` | Behavior-preserving restructure |
| `test` | Tests only |
| `build` | Build or packaging |
| `ci` | Workflows and release tooling |
| `chore` | Maintenance that does not fit above |
| `revert` | Reverts a previous commit |

Examples:

```
feat: add per-site pause
fix(popup): restore contrast in dark mode
feat!: rename storage keys
```

A breaking change uses `!` after the type (or scope), or a footer:

```
BREAKING CHANGE: disabledSites is now a hostname list
```

GitHub’s `Revert "…"` title is accepted. Merge commits are ignored.

Prefer **squash merge**. The pull request title becomes the commit on `main`, so that title must already be conventional. A trailing `(#123)` is fine.

Check a title locally:

```sh
bun scripts/lint-pr-title.mjs
```

`PR_TITLE` can be set in the environment instead of passing the title as an argument.

## SemVer

This project uses [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). `package.json` and `manifest.json` stay on the same `MAJOR.MINOR.PATCH` version.

Merges to `main` are classified as:

| Commits | Release |
| --- | --- |
| `feat` | `MINOR` |
| `fix`, `perf`, `revert` | `PATCH` |
| `BREAKING CHANGE` or `!` | `MAJOR` |
| `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore` | none |

The changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries list the change, not the author.

After a releasable merge, CI packages the extension zip, tags `vX.Y.Z`, updates `CHANGELOG.md`, and publishes a GitHub Release.

## Pull requests

1. Branch from `main`.
2. Keep the pull request title conventional.
3. Leave versions alone.
4. Say what changed and how you checked it.

## Attribution

Commits, tags, and releases are authored by people.

- Do not add `Co-authored-by` trailers for bots, agents, or tools
- Do not add Generated-by, Made-with, or similar footers
- Do not add bots to contributor lists or the changelog
- The release workflow must use a personal `RELEASE_TOKEN`, never the default Actions identity

## Release token

Maintainers: the pipeline publishes only when a personal token is available.

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens) for this repository with **Contents: Read and write**. A classic token with the `repo` scope also works.
2. Add it as the repository secret `RELEASE_TOKEN` (**Settings → Secrets and variables → Actions**).
3. Allow that account to push the version commit and tag to `main` (bypass branch protection if reviews are required).
4. Use squash merge with conventional titles.

The first successful run on `main` tags `v0.1.0` if no version tags exist yet. Later `feat` / `fix` / breaking merges cut the next SemVer release.
