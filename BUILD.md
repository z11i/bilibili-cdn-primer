# Source package / 源代码包

## English

Version: **0.2.0**

This source archive contains the original, readable extension files, original icon artwork, tests, documentation, and a reproducible packaging script. No minification, transpilation, bundling, or remote code loading is used.

### Reproduce the submitted extension

Requirements: **Python 3**. No npm installation is required to reproduce the extension archive.

From this directory, run:

```sh
python3 scripts/package.py
```

Output: `dist/bilibili-cdn-primer-0.2.0.zip`.

Expected SHA-256:

```
c2678b842463f271aa57f09a87b75fbcc226757f9d863ea49f0e266fc406e84d
```

This is byte-for-byte identical to the submitted runtime ZIP named `bilibili-primer-0.2.0.zip`. Archive filenames differ; the archive bytes and all packaged files are identical. Packaging uses fixed file order, timestamps, permissions, and ZIP compression. The checksum was verified with Python 3.9.6 and zlib 1.2.12 on macOS; a different zlib implementation can change ZIP compression bytes without changing extension source contents.

### Optional validation

For tests and Mozilla validation, install Node.js 22+ and run:

```sh
npm ci --ignore-scripts
npm run check
```

These development dependencies are not part of the extension. The `extension/` directory can also be loaded directly in Firefox using `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `extension/manifest.json`.

Project: https://github.com/z11i/bilibili-cdn-primer
Support: https://github.com/z11i/bilibili-cdn-primer/issues

## 简体中文

版本：**0.2.0**。

本源代码包包含可直接审阅的扩展源文件、原创图标、测试、文档和可复现的打包脚本。没有代码压缩、转译、合并或远程代码加载。

### 重建提交的扩展

只需要 **Python 3**，不需要安装 npm 依赖。

在此目录运行：

```sh
python3 scripts/package.py
```

输出：`dist/bilibili-cdn-primer-0.2.0.zip`。

预期 SHA-256：

```
c2678b842463f271aa57f09a87b75fbcc226757f9d863ea49f0e266fc406e84d
```

此文件与提交的 `bilibili-primer-0.2.0.zip` 逐字节一致，文件名不同，但软件包字节和其中的文件相同。打包脚本固定文件顺序、时间戳、权限和 ZIP 压缩方式。不同 zlib 实现可能改变压缩字节，但不改变扩展源文件内容。

### 可选验证

如需运行测试和 Mozilla 验证器，请安装 Node.js 22+，然后运行：

```sh
npm ci --ignore-scripts
npm run check
```

这些开发依赖不包含在扩展中。也可在 Firefox 打开 `about:debugging#/runtime/this-firefox`，选择“临时载入附加组件”，直接加载 `extension/manifest.json`。

项目：https://github.com/z11i/bilibili-cdn-primer
反馈：https://github.com/z11i/bilibili-cdn-primer/issues
