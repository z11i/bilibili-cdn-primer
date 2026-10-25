# Contributing / 贡献指南

## English

Use GitHub Issues for bugs and feature requests. Include the extension version, Firefox version, relevant settings, and a concise reproduction. Diagnostic exports can contain media identifiers and network details; remove anything you do not want public. Do not post signed media URLs, cookies, credentials, or browser profiles.

For changes, keep runtime dependencies minimal, preserve bounded network behavior, and update both locale catalogs when adding interface text. Add focused tests for scheduling or request behavior changes. Run `npm run check` and `npm run build` before opening a pull request. Describe the resulting behavior and relevant validation.

## 简体中文

欢迎通过 GitHub Issues 提交问题与功能建议。请提供扩展版本、Firefox 版本、相关设置和简洁的复现方法。诊断文件可能包含视频标识和网络信息，公开前请移除不希望分享的内容。不要上传签名媒体地址、Cookie、登录凭据或浏览器配置目录。

修改代码时请控制运行时依赖，保持请求与流量限制；新增界面文字时同步更新中英文语言文件。对调度或网络行为的修改，应添加有针对性的测试。提交 Pull Request 前运行 `npm run check` 和 `npm run build`，并说明修改后的行为与验证结果。
