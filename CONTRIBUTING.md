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

After a releasable merge, CI packages the extension zip, tags `vX.Y.Z`, updates `CHANGELOG.md`, and publishes a GitHub Release. A follow-up workflow then uploads that zip to the Chrome Web Store.

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

## Chrome Web Store

After each SemVer GitHub Release is published, CI uploads the release zip and submits it for Chrome Web Store review. The listing must already exist; the API cannot create a new item.

One-time setup:

1. In the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), create the item, fill the **Store listing** and **Privacy** tabs, and publish once by hand with the visibility you want. Copy the 32-character item ID. Copy the publisher ID from **Publisher → Settings**. The Google account needs 2-step verification.
2. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project and enable **Chrome Web Store API**.
3. Configure the **OAuth consent screen** as External, add your publisher email as a test user, then publish the app (**Audience → In production**). Leaving it in Testing makes refresh tokens expire after seven days.
4. Create an OAuth **Web application** client. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI.
5. In the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), open the gear menu, choose **Use your own OAuth credentials**, and enter the client ID and secret. Authorize the scope `https://www.googleapis.com/auth/chromewebstore` with the same Google account that owns the listing. Exchange the code and copy the refresh token.
6. Add these repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
| --- | --- |
| `CHROME_EXTENSION_ID` | 32-character item ID |
| `CHROME_PUBLISHER_ID` | Publisher ID |
| `CHROME_CLIENT_ID` | OAuth client ID |
| `CHROME_CLIENT_SECRET` | OAuth client secret |
| `CHROME_REFRESH_TOKEN` | OAuth refresh token |

Optional repository variable `CHROME_PUBLISH_TARGET`: `trustedTesters` or `STAGED_PUBLISH`. Unset means default production publish.

To retry a release, run **Actions → Chrome Web Store → Run workflow** and enter the tag (`vX.Y.Z`).
