# Playback measurements / 播放测量

## 简体中文

此本地开发构建用于判断预热是否帮助播放器。默认进入“仅观察”，不会发送扩展的索引或片段请求；播放器照常运行。

1. 临时加载当前 ZIP，刷新视频页面，确认版本为 0.4.2、模式为“仅观察”。
2. 保持视频标签页在前台，正常播放 2–3 分钟，尽量不跳转、不改变清晰度。出现卡顿时让记录继续。
3. 在“诊断详情”导出 JSON，保留这一轮基线。
4. 再用“受限预热”测试一段未看过、条件相近的视频。默认请求最多 0.35 秒、约 256 KiB；所有标签页合计每分钟 8 MiB。播放器正在下载时不发新请求；开始下载时取消扩展探测。小于上限的片段仍可能完整下载。
5. 再导出一次。模式或设置变化也会记录，便于对齐时间。

不要用已经预热过的同一片段直接作为冷缓存对照。不同片段大小、CDN、编码、缓存状态和测试时间都会影响结果。先分析基线，再决定下一轮测试条件；同一份日志中的相关性不能证明因果。

导出包括播放器请求的范围、首字节等待、结束时间、缓存头、取消错误、与预热并发的时间，以及此前同 CDN、同资源、范围重叠的预热记录。每两秒尝试采样播放位置和缓冲，另记 waiting、playing、seeking 等事件及等待区间。启动与跳转等待单独分类。计时器在后台可能被浏览器节流。

播放器字节数来自完成响应的响应头估计；中止下载的实际部分字节未知。响应头不能证明实际网络吞吐量或 CDN 缓存已填充。扩展不读取播放器的媒体正文。诊断保存在内存中，导出到本地，没有上传服务。

保留上限：最近 1000 条播放器请求、1800 条播放事件和 300 条预热事件，超出后覆盖旧记录；UI 请求计数是本次扩展运行的累计值，因此长时间会话中计数可能超过导出记录数量。

## English

This local development build measures whether priming helps playback. It starts in **Observe only** and makes no extension index or segment requests.

1. Load the current ZIP temporarily, refresh the video, and confirm version 0.4.2 and Observe only mode.
2. Play normally in a visible tab for 2–3 minutes. Avoid seeks and quality changes; keep recording through stalls.
3. Export a baseline JSON from Diagnostics.
4. Test Limited priming on a comparable unwatched section. Defaults are 0.35 seconds and roughly 256 KiB per probe, with a shared 8 MiB/minute budget. Player downloads block new probes and preempt active ones. A small segment can still finish before the limit.
5. Export again. Configuration changes are timestamped.

Do not use an already primed section as a cold-cache control. Segment size, codec, CDN, cache state, and time can confound comparisons. Analyze the baseline before deciding the next controlled test; logged associations alone do not establish causation.

Exports include player ranges, first-byte and completion times, cache headers, cancellations, overlap with priming, and preceding same-CDN/resource/range prime attempts. Position and buffer samples are targeted every two seconds, supplemented by player events and wait intervals. Startup and seek waits are classified separately. Background timers may be throttled.

Completed player byte counts are estimates from response headers; bytes received before cancellation are unknown. These are not wire-level bandwidth measurements. Player media bodies are not intercepted. Diagnostics remain in memory and are exported locally without an upload service.

Retention: last 1000 player requests, 1800 playback events, and 300 prime events. Older entries roll off; cumulative UI counters can exceed the number of exported records in long sessions.

自适应预热 / Adaptive priming: [模式说明 / mode details](adaptive.md).
