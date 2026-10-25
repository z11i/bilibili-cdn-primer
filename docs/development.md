# Development and packaging

[简体中文](development.zh-CN.md)

## Requirements

- Desktop Firefox 142+ for running the extension.
- Node.js 22+, npm, and Python 3 for checks and packaging.

```sh
npm ci --ignore-scripts
npm run check
npm run build
```

The runtime is the unmodified contents of `extension/`. No transpilation, bundling, minification, or remote code is used. Mozilla’s `web-ext` is a development-only dependency. The packaging script writes a deterministic unsigned ZIP and SHA-256 checksum to `dist/`; it does not sign or publish anything.

To test interactively, load `extension/manifest.json` from Firefox’s `about:debugging#/runtime/this-firefox`, then refresh the video page. After editing source, reload the extension in that page and refresh the video again.

## Runtime design

| File | Responsibility |
|---|---|
| `core.js` | Settings validation, allowed media URLs, SIDX parsing, and time-window calculation |
| `background.js` | Request observation, index/segment requests, headers, cancellation, and shared traffic budget |
| `content.js` | Player events, active representation matching, moving schedule, and seek/stream changes |
| `i18n.js`, `_locales/` | Page-language selection and localized strings |
| `popup.*` | Status, settings, and diagnostic export |

The extension matches observed player requests to available DASH representations before priming. It reads the selected representation’s index and schedules exact ranges beyond the current buffer. Request cancellation covers connection, headers, and body transfer. A seek changes the schedule generation, so old asynchronous results cannot restart obsolete work.

Lead is measured in wall-clock seconds and adjusted for playback rate. The window is measured in video seconds. The effective lead is at least the request deadline plus the configured settle and delivery allowances. These allowances are estimates; they do not prove that a cache fill has completed.

## Verification

Unit tests run without a browser or external network. They use synthetic indexes and mocked browser APIs to cover range parsing, time windows, body-transfer cancellation, tab/token ownership, traffic limits, header isolation, stale work after seeks, and localization. CI also runs Mozilla’s package validator and generates an unsigned artifact.

For a release, additionally test actual playback in Firefox: stream detection, successful index response, segment requests, seeks and stream changes, settings persistence, request cancellation, and the traffic budget. Check later player downloads separately when evaluating playback benefits.

## Publishing

Upload the archive in `dist/` to the Mozilla Add-ons Developer Hub. The package contains readable source, so no compiled-source reconstruction is needed. Store text is in `docs/amo-listing.en.md` and `docs/amo-listing.zh-CN.md`; the privacy policy is in the root of the repository and in the extension. Use GitHub Issues as the support website.

Keep the extension ID unchanged after publication. Increase the version in `extension/manifest.json` and `package.json` together for each update. Normal distribution requires Mozilla signing; local ZIP artifacts are unsigned.
