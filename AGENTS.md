# AGENTS.md

Changes land through pull requests against `main`. See `CONTRIBUTING.md` for the full standard.

## Verification

Run `bun run check` before saying work is done.

Check a proposed commit message or PR title:

```sh
bun scripts/lint-commit.mjs "<message>"
bun scripts/lint-pr-title.mjs "<title>"
```

Both also read `COMMIT_MESSAGE` / `PR_TITLE` from the environment.

## Commit and PR conventions

- Commit messages and PR titles follow Conventional Commits: `<type>[optional scope][optional !]: <description>`.
- Types: `feat`, `fix`, `perf`, `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore`, `revert`.
- A breaking change uses `!` after the type (or scope), or a `BREAKING CHANGE:` footer.
- Squash merge is used, so the PR title becomes the commit on `main`. A trailing `(#123)` is fine.
- Do not add `Co-authored-by` trailers for bots, agents, or tools, or `Generated-by` / `Made-with` footers.

## Versions and releases

- Do not bump `package.json` or `manifest.json` yourself. Versions are cut by the release workflow.
- Do not run `bun run release` or `scripts/release.mjs`. It tags, pushes, and publishes a GitHub release; releases belong to CI.

## Parallel workspaces on a shared host

This repo is checked out in multiple sibling Paseo worktrees on the same machine.

- Bind listeners to `$PASEO_PORT` and `$HOST`. Paseo assigns each service instance a distinct port.
- Run `paseo script start preview` to serve the worktree root through Paseo's supervised service proxy.
- Keep temporary test output in unique `mkdtemp` directories.
- Do not install global tools or write outside the worktree.
- Build output stays in the worktree-local `dist/` directory. Paseo removes the worktree after its final workspace reference is archived.
