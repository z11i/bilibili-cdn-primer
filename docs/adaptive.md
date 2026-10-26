# 自适应预热 / Adaptive priming

## 简体中文

0.4.2 是本地开发构建。默认仍是“仅观察”。临时加载后刷新视频，在弹窗的“工作模式”选择“自适应预热”；开启后再播放并导出诊断。

- 初始读取目标为 256 KiB，总超时为 8 秒。先达到字节目标便取消；小片段可能完整下载。流式读取的最后一块可能超过目标。总超时包含连接、首字节等待和正文读取，并非收到数据后才计时。
- 每个 CDN 主机和视频资源分别保存本次运行的估计。只利用已完成、HTTP 206、非浏览器缓存的播放器请求；要求前面有同一标签页、同一主机、同一资源、范围重叠且收到数据的自适应探测。探测和播放器响应的 IP 必须一致，播放器下载期间不能与预热并发；每个探测最多产生一个反馈样本。跳转或取消错误不用于调整。
- “较快”指首字节等待小于 0.5 秒，且总下载时间少于相应视频片段播放时长的 60%。连续三次较慢时只调整一个变量：首字节慢则提前 5 秒，否则提高读取目标。连续六次较快则降低读取目标。三次总超时且没有收到数据时也尝试增加提前量。这些是待验证的启发式规则，不是优化结论。
- 提前量从约 20 秒开始，并考虑总超时、设置中的等待时间和余量，受自适应最大提前量限制。读取档位为 64 KiB、256 KiB、1 MiB、4 MiB，默认上限 1 MiB。总超时默认 8 秒不会自动增长；用户可以更改上限和超时。
- 播放缓冲低于设置阈值时进入恢复状态：目标缩至 64 KiB、总超时 1 秒，挑选最近尚未缓冲的片段，每个资源最多每 15 秒尝试一次。它只在播放器无下载任务时运行；同一标签页的播放器开始下载时取消普通扩展请求；其他标签页不会抢占本页的请求。恢复效果尚未在真实播放中验证，播放器持续下载时可能没有运行机会。
- 所有模式共享设置中的每分钟流量预算和单个请求通道。固定模式的“单次请求时长”“单次读取上限”“提前量”由自适应策略替代；预热窗口、等待余量、暂停/隐藏标签页选项仍适用。切换进度或视频流取消过时任务。

弹窗显示读取目标、超时、提前量、样本数、恢复状态和调整依据。导出包含每次请求的策略及 `adaptiveDecisions`。诊断不含媒体 URL 查询参数，估计仅保存在内存中，不上传。

若样本数一直为 0，通常是播放器没有请求已探测的范围、请求未完成、IP 不同或存在并发；不应把没有反馈误解为效果很好。扩展不固定 CDN IP，不修改播放器下载，不缓存正文供播放器使用。成功请求或后续变快都不能单独证明 CDN 缓存已就绪。

### 持续阻塞时的受限并发

“允许受限并发探测（实验性）”默认关闭，需在“预热设置”中勾选并保存。开启后，本标签页连续等待达到设定时间（默认 10 秒）时，可在播放器仍有下载任务的情况下尝试一次探测。每个标签页最多每 30 秒一次；普通探测最多约 256 KiB，恢复探测最多约 64 KiB，总超时不超过 3 秒，仍受共享流量预算和单一扩展请求通道限制。超时从连接前开始，仍可能没有收到数据。

索引并发读取仅允许最多 64 KiB 的索引范围。并发探测跳过播放器已在下载的同资源重叠范围；若播放器后来开始请求探测中的范围，会取消扩展请求。跳转、页面关闭、配置变化仍会取消请求。并发样本不训练普通预热的反馈模型，避免把竞争造成的变慢误当作需要加大预热。

弹窗显示本标签页的阻塞请求数、已等待时长及冷却剩余时间；“诊断详情”列出最近请求的主机、范围、请求标识和存续时间。导出含 `scheduler`、`schedulerDecisions` 和每次请求的 `concurrent` 标志。缺少结束事件超过 120 秒的请求会从阻塞状态移除，避免永久等待。只有工作模式下拉框控制启用状态；不再使用可能误切回固定模式的重复开关。

并发会占用带宽，是否减少卡顿尚需对照测试。可随时取消勾选或切回“仅观察”。

## English

0.4.2 is a local development build and still defaults to Observe only. Reload the video after temporary installation, select **Adaptive priming**, then play and export diagnostics.

The initial target is 256 KiB with a separate eight-second overall timeout, including connection and first-byte wait. Streaming chunks can overshoot the byte target; small segments may finish. Targets use 64 KiB, 256 KiB, 1 MiB and 4 MiB tiers, subject to a configurable ceiling (1 MiB by default). The timeout is configurable and does not grow automatically.

Session estimates are scoped to CDN hostname and media path. Feedback requires a completed non-browser-cached HTTP 206 player request after a same-tab/resource overlapping adaptive probe that received bytes. Both responses must report the same IP, with no concurrent priming during the player download. Each prime contributes at most one sample. Cancellations and seek errors do not train the estimates.

A fast association means first-byte wait below 500 ms and total time below 60% of that segment's playback duration. Three consecutive slow associations increase lead by five seconds if first-byte waiting is slow; otherwise they increase the byte target. Six fast associations reduce bytes. Three no-body deadline expirations increase lead without claiming success. These are experimental heuristics, not demonstrated optimal settings.

Lead begins near twenty seconds, includes configured timeout/settle/margin allowances, and is capped by the adaptive lead ceiling. Fixed-mode duration, byte cap and lead are replaced by adaptive controls. Window length, pause/visibility preferences and the global rolling traffic budget still apply.

Low buffer enables an experimental recovery state: nearest unbuffered segments, 64 KiB target, one-second timeout and at most one attempt per resource every fifteen seconds. Recovery and normal probes run only while the player has no downloads; new player downloads in the same tab preempt normal probes. Other tabs no longer block or preempt this tab. Continuous downloading in this tab can still block idle-only recovery unless bounded concurrency is explicitly enabled. Recovery probes do not train normal-mode estimates.

The popup shows current policy, feedback count, recovery state and adjustment reason. Exports include per-request policy and `adaptiveDecisions`. Zero samples indicate insufficient comparable evidence, not a successful policy. Estimates are bounded, in memory and never uploaded. The extension does not pin IP addresses or retain media for player reuse, and logged associations do not establish cache readiness or causal playback improvement.

### Bounded concurrency

Enable **Allow bounded concurrent probes (experimental)** in settings and save to escape prolonged same-tab blocking. It is off by default. After sustained waiting (10 seconds by default, configurable), a probe may run alongside player downloads, at most once per tab every 30 seconds. Normal concurrent probes have an approximate 256 KiB ceiling; recovery probes retain a 64 KiB ceiling. Overall timeout is at most three seconds. The shared rolling byte budget and single extension fetch slot still apply. Concurrent index reads are limited to 64 KiB.

Already downloading overlapping ranges are skipped. If the player starts downloading the same resource/range during a concurrent probe, the extension aborts its copy. Seeks, navigation and settings changes still cancel obsolete work. Concurrent probes do not train ordinary priming feedback. They may compete for bandwidth; improved playback remains unverified.

The popup shows same-tab blockers, waiting duration and cooldown. Diagnostics list request IDs, hosts, byte ranges and ages. Exports include `scheduler`, `schedulerDecisions` and per-request `concurrent` flags. Missing terminal events expire after 120 seconds rather than blocking forever. The mode dropdown is now the single enable control.

0.4.2：同一媒体路径在 CDN 镜像间切换时保留已解析的分段索引；不同资源或明确变化的索引范围重新读取。导出现在也记录成功的索引请求，便于区分索引读取与片段预热。

0.4.2 retains the parsed index across CDN mirrors of the same media path. Different resources or explicitly changed index ranges invalidate it. Successful index requests are now exported separately by `kind`, so index activity cannot be mistaken for segment priming.
