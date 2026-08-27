# I'm an Adult

<img src="assets/logo.svg" alt="I’m an Adult." height="56">

A Chrome extension that gives scrolling back to the user.

By default it:

- prevents pages from cancelling wheel and touch scrolling
- removes smooth scrolling and scroll snapping
- disconnects CSS and JavaScript scroll-driven animation timelines

The toolbar popup can pause the extension per site. It also has optional controls that restore normal browser cursors, hide common JavaScript cursor followers, and pause autoplaying media until the user interacts with the page.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this directory.

Reload open tabs after installing the extension or changing a setting. Chrome does not run newly installed content scripts in pages that are already open.

## Development

Requires [Bun](https://bun.sh).

```sh
bun run check
bun test
```

The extension uses Manifest V3 and requires Chrome 111 or newer because its earliest content script runs in the page's `MAIN` world. This lets it intercept scroll cancellation before site JavaScript can cache the native event methods.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the commit standard, SemVer policy, and release setup. Published versions are listed in [CHANGELOG.md](CHANGELOG.md) and on [Releases](https://github.com/yannelli/im-an-adult/releases). After the Chrome Web Store listing is connected, each SemVer GitHub Release is also submitted to the store.

## Limits

Chrome does not allow extensions to run on browser-owned pages, the Chrome Web Store, or other extension pages. Sites can also implement scrolling with unusual rendering systems that do not use native document scrolling. Use the per-site switch if a site depends on custom wheel or touch gestures, such as a map or canvas editor.
