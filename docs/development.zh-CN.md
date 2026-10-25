# 开发与打包

[English](development.md)

## 环境要求

- 运行扩展：桌面版 Firefox 142 或更新版本。
- 验证与打包：Node.js 22+、npm、Python 3。

```sh
npm ci --ignore-scripts
npm run check
npm run build
```

`extension/` 中的文件直接构成扩展，无转译、合并、压缩混淆或远程代码。Mozilla 的 `web-ext` 仅用于开发验证。打包脚本将可复现的未签名 ZIP 和 SHA-256 校验值写入 `dist/`，不会签名或发布。

交互测试时，在 Firefox 的 `about:debugging#/runtime/this-firefox` 中加载 `extension/manifest.json`，然后刷新视频页面。修改源文件后，先在该调试页面重新加载扩展，再刷新视频页面。

## 运行结构

| 文件 | 职责 |
|---|---|
| `core.js` | 设置校验、媒体地址限制、SIDX 解析和时间范围计算 |
| `background.js` | 请求观察、索引与片段读取、请求头、取消和共享流量预算 |
| `content.js` | 播放器事件、视频流匹配、移动调度和跳转处理 |
| `i18n.js`、`_locales/` | 页面语言选择与本地化文本 |
| `popup.*` | 状态、设置和诊断导出 |

扩展先将实际播放器请求与 DASH 视频流匹配，再读取选中视频流的索引，在当前缓冲范围之后安排准确的片段字节范围。取消时限覆盖连接、响应头和正文传输。跳转会更新调度代次，旧异步结果不能重新启动过时任务。

提前量按实际秒计算并随播放速度调整；预热范围按视频时间轴秒计算。有效提前量至少覆盖单次请求时限、CDN 等待余量及下载余量。这些是调度估计，不能证明缓存已填充完成。

## 验证

单元测试不需要浏览器或外部网络。测试采用合成索引和模拟接口，覆盖范围解析、时间窗口、正文传输取消、标签页与令牌归属、流量限制、请求头隔离、跳转后的旧任务及本地化。CI 同时运行 Mozilla 验证器并生成未签名的软件包。

发布前还需在 Firefox 验证实际播放：视频流检测、索引响应、片段请求、跳转与视频流切换、设置保存、请求取消和流量预算。评估播放收益时，应单独检查播放器之后发起的下载。

## 发布

将 `dist/` 中的软件包上传至 Mozilla Add-ons Developer Hub。软件包已包含可读源代码，无需还原编译结果。商店文本位于 `docs/amo-listing.en.md` 与 `docs/amo-listing.zh-CN.md`；隐私说明位于仓库根目录和扩展内部。问题反馈可使用 GitHub Issues。

首次发布后保持扩展 ID 不变。每次更新时同步提高 `extension/manifest.json` 和 `package.json` 中的版本号。正式分发需要 Mozilla 签名，本地构建的 ZIP 未签名。
