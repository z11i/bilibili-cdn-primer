# Local diagnostic build / 本地诊断构建

Version / 版本：0.4.2

This build is for local playback measurement. No signing or publication step is included.
此构建用于本地播放测量，不包含签名或发布步骤。

Requires Python 3 / 需要 Python 3：

```sh
python3 scripts/package.py
```

Output / 输出：`dist/bilibili-cdn-primer-0.4.2.zip`

SHA-256：

```
ae0200b3f9e12269597b3776c225f5b68d0176c8537a5d7579edbe23aaaf4a8e
```

Optional validation / 可选验证（Node.js 22+）：

```sh
npm ci --ignore-scripts
npm run check
```

The extension source is shipped directly; there is no compilation or bundling. ZIP compression bytes can vary between zlib versions.
扩展直接使用源文件，不进行编译或合并。不同 zlib 版本可能改变 ZIP 压缩字节。

See / 参阅：[measurement procedure / 测量流程](docs/measurement.md)。
