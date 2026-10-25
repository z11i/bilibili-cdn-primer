[简体中文](PRIVACY.zh-CN.md)

# Privacy policy

Bilibili CDN Primer · October 25, 2026

## Media requests

The extension reads playback metadata, media requests, and playback position on Bilibili pages to request upcoming video ranges. These requests go to the supported CDN already used by the video. They contain the original signed media URL, requested byte range, and Bilibili page origin/referrer. Original URLs can contain account-related identifiers and temporary tokens supplied by Bilibili. The CDN also receives the IP address and normal browser request information needed for the connection. Requests omit browser cookies; the extension does not separately collect login credentials.

## Local data

Settings are stored locally in Firefox. Recent diagnostics are held in memory and contain media identifiers, byte ranges, timing, traffic, CDN addresses, and response headers. Video bodies are discarded. Diagnostic export is manual and saves a file to your device. Exports include participating tabs, but omit signed media query strings.

## Recipients and controls

Priming uses additional bandwidth. There are no analytics, advertising, or developer telemetry services, and diagnostics are not uploaded to a developer server. You can disable priming or adjust request and traffic limits at any time. Removing the extension stops it. Private browsing is not supported.

This independent tool is not affiliated with Bilibili, Mozilla, or CDN providers. The video service and CDN providers process requests under their own privacy policies.
