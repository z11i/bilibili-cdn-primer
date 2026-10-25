# Firefox Add-ons listing (English)

Name: Bilibili CDN Primer


Summary: Prime upcoming Bilibili video segments with configurable timing and traffic limits.

Description:

Request upcoming Bilibili video segments ahead of playback and end each request after a configurable duration. The extension follows the video representation and CDN actually used by the player, rebuilding its schedule after seeks or stream changes.

- Schedule segments using playback position, buffered data, and playback speed.
- Configure the look-ahead window, request duration, intervals, and traffic limits.
- Yield to the player when its playback buffer is low.
- Share request and traffic limits across tabs.
- Use Simplified Chinese or English, following the page language or a manual selection.
- View status locally and export diagnostics when needed.

Priming uses additional bandwidth. Playback benefits depend on the network path, CDN caching, and video service. The extension does not switch the player's CDN or change DNS or routing. Support currently covers video tracks in some DASH on-demand videos, not live streaming or audio priming.

Requests are sent to the video's existing supported CDN with Bilibili's signed media URL, requested byte range, and page origin/referrer. Diagnostics stay local unless you manually export and share them. There is no developer telemetry or advertising service.

This independent extension is not affiliated with Bilibili, Mozilla, or CDN providers.

Compatibility: Desktop Firefox 142 or later .

Suggested categories: Photos, Music & Videos; Other.

License: MIT.

Release notes (0.2.0): Simplified Chinese default; automatic page-language matching and manual language selection; version badge; original icon; revised settings and diagnostics; privacy policy and publication metadata.
