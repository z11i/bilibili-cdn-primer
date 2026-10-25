<p align="center"><img src="extension/icons/icon-128.png" width="80" alt="哔哩哔哩 CDN 预热"></p>
<h1 align="center">哔哩哔哩 CDN 预热</h1>
<p align="center">为 Firefox 中的哔哩哔哩视频提供可控的后续片段预热。</p>
<p align="center">简体中文 · <a href="README.md">English</a> · <a href="PRIVACY.zh-CN.md">隐私说明</a> · <a href="https://github.com/z11i/bilibili-cdn-primer/issues">问题反馈</a></p>

扩展会提前请求即将播放的 DASH 视频片段，并在设定时长后结束请求。它跟随播放器实际使用的视频流和 CDN，在跳转进度、调整播放速度或切换视频流时重新安排预热。

## 功能

- 结合播放位置与已缓冲数据，维护移动的预热范围。
- 读取视频的 SIDX 索引，使用准确的片段字节范围；页面信息缺失时，可通过有大小限制的视频头部读取获取索引。
- 自定义请求时长、单次流量、请求间隔和提前量。
- 所有标签页共享单一请求通道和滚动流量预算。
- 跳转或切换视频流后取消旧任务；缓冲不足时优先保障当前播放。
- 默认简体中文，支持英文和手动切换；自动模式参考视频页面声明的语言。
- 本地状态显示和诊断导出。

预热会增加网络流量，实际效果取决于 CDN 缓存、视频服务及网络路径。扩展不切换播放器的 CDN、不更改 DNS，也不保留视频供播放器读取。目前支持部分 DASH 点播视频的视频轨，不包括音频预热或直播。

## 开发版安装

需要桌面版 Firefox 142 或更新版本。

1. 克隆本仓库，或下载并解压源代码。
2. 在 Firefox 打开 `about:debugging#/runtime/this-firefox`。
3. 选择“临时载入附加组件”，打开 `extension/manifest.json`。
4. 刷新哔哩哔哩视频页面，打开扩展弹窗。

临时安装在 Firefox 重启后失效。正式安装需要由 Mozilla 签名的软件包。详见[开发与打包](docs/development.zh-CN.md)。

## 使用

在弹窗中启用预热。打开“预热设置”，可调整预热范围、时长、流量限制和界面语言。默认每次请求最多持续 2 秒，提前量为 20 个实际秒，预热范围为 60 个视频秒。所有标签页共享每分钟 32 MiB 的流量预算。

CDN 筛选仅决定扩展何时预热，不会重定向播放器。播放器已缓冲超出目标范围时，无需额外请求。诊断分别记录部分读取、完整读取和失败请求，不将请求成功直接等同于缓存已就绪。

<p><img src="docs/images/popup-zh-CN.png" width="320" alt="Firefox 中的简体中文弹窗"></p>

## 隐私

预热请求发往视频原本使用的受支持 CDN，使用哔哩哔哩提供的签名媒体地址、字节范围和页面来源，不附带浏览器 Cookie。设置保存在 Firefox 本地存储中；近期诊断仅保存在内存中，手动导出时保存到本地文件。扩展没有广告、分析或开发者遥测服务，不在隐私浏览窗口运行。

请参阅[隐私说明](PRIVACY.zh-CN.md)与[权限说明](docs/permissions.md)。

## 开发

验证与打包需要 Node.js 22+、npm 和 Python 3。

```sh
npm ci --ignore-scripts
npm run check
npm run build
```

扩展没有运行时依赖或编译步骤。`npm run check` 运行单元测试和 Mozilla 扩展验证器；构建命令将未签名的软件包写入 `dist/`。测试使用合成媒体索引和模拟的浏览器、网络接口，不连接哔哩哔哩。

## 反馈与贡献

欢迎通过 [GitHub Issues](https://github.com/z11i/bilibili-cdn-primer/issues) 反馈问题或提出建议。请附上扩展和浏览器版本；分享诊断文件前检查其内容，其中可能包含视频标识和网络信息。

参见[贡献指南](CONTRIBUTING.md)。本项目采用 MIT 许可证，是独立工具，与哔哩哔哩、Mozilla 或 CDN 服务商没有官方关联。
