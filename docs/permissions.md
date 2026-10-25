# Permissions / 权限说明

| Permission | Purpose | 用途 |
|---|---|---|
| `storage` | Save extension settings locally | 在本地保存扩展设置 |
| `webRequest` | Observe playback metadata and active media requests | 观察播放信息与实际媒体请求 |
| `webRequestBlocking` | Copy bounded playurl responses transparently; set Origin/Referer only on the extension’s own media requests | 透明读取有大小限制的 playurl 响应副本；仅为扩展自己的媒体请求设置 Origin/Referer |
| `https://*.bilibili.com/*` | Access the player page and playurl API; content scripts run only on `www.bilibili.com` | 访问播放器与 playurl API；内容脚本仅在 `www.bilibili.com` 运行 |
| `https://*.bilivideo.com/*` | Read supported video index and segment ranges | 读取受支持的视频索引与片段 |
| `https://upos-hz-mirrorakam.akamaized.net/*` | Read supported Akamai video ranges | 读取受支持的 Akamai 视频片段 |

Media URL checks additionally require HTTPS and a supported `upgcxcode` `.m4s` path. The extension does not execute downloaded code, modify page security headers, or cancel player requests. Private browsing is disabled.

媒体地址还必须满足 HTTPS 和受支持的 `upgcxcode` `.m4s` 路径要求。扩展不执行下载的代码、不修改页面安全响应头，也不取消播放器请求，隐私浏览已禁用。

Firefox’s data-use declaration lists browsing activity and website content because the video’s CDN receives the signed media request and page referrer. This declaration describes the functional media requests, not an analytics service. See the [privacy policy](../PRIVACY.md).

Firefox 的数据用途声明包含浏览活动和网站内容，因为视频 CDN 会收到签名媒体请求及页面来源。这些是功能性媒体请求，不是分析服务。详见[隐私说明](../PRIVACY.zh-CN.md)。
