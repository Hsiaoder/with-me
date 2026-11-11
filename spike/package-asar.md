# 装机产物的 asar 判定（2026-11-11）

分支：**A**（asar:true + asarUnpack 三条 glob 就够，`net.fetch` 走通了 `app.asar.unpacked` 的重定向；协议层不动）

命令：`npm run dist` → `node e2e/package-check.mjs`

> 关于跑法的重要说明：本机装了 Device Guard / 智能应用控制，会**拒绝执行改名后的未签名 `release/win-unpacked/with-me.exe`**（直接跑报 “已被你的组织的 Device Guard 代码保护阻止”；`node e2e/package-check.mjs` 因此停在 `electron.launch` 的 “Process failed to launch!”）。这不是打包坏了，是本机安全策略拦 exe。
> 为了仍然拿到**真实测**（而非推测）的判定，我改用**有信誉的** `node_modules/electron/dist/electron.exe` 直接加载**同一份构建产物** `release/win-unpacked/resources/app.asar`（旁边就是它的 `app.asar.unpacked`）。`electron.exe app.asar` 与装机 exe 走的是同一套 asar→unpacked 重定向，断言逐条照抄 `package-check.mjs`，只换了启动方式。判定基于这套实测。

实测输出（asar 路径跑法打印的 JSON，原样贴入）：

```json
{
  "code": {
    "url": "app://assets/renderer/index.html",
    "skinName": "色块"
  },
  "webm": {
    "src": "app://skin/click/tapped.webm",
    "w": 640,
    "h": 360
  },
  "voiceManifest": {
    "status": 200,
    "bytes": 27469
  },
  "mp3": {
    "file": "voice/line-001.mp3",
    "duration": 5.808
  },
  "font": {
    "sans": true,
    "num": false
  }
}
```

第 1 层（代码在 asar 内）：绿。`location.href === app://assets/renderer/index.html`，`__petDebug` 到位，`pageErrors` 空。
第 2 层（媒体在 asar 外）：
- webm：绿。`video.is-front` 解出真实画面 640×360，src 是 `app://skin/click/tapped.webm`——这个文件就在 `app.asar.unpacked/skins/block/animation/click/`，说明 `net.fetch` 跟着重定向读到了 unpacked。
- 语音：绿。`voice/manifest.json` 取回 200 / 27469 字节（数组形状，首条 `file` 带 `voice/` 前缀，和真实样例一致）；`voice/line-001.mp3` 出时长 5.808s，mp3 也在 `app.asar.unpacked/dist/renderer/voice/`。
- 字体：`document.fonts.check` 给出 `sans:true / num:false`。这个 `num:false` **不是媒体拿不到**，见下面的专项复核。

专项复核（字体那一格为什么红）：

```json
{
  "numFetch":   { "status": 200, "bytes": 1776 },
  "sansFetch":  { "status": 200, "bytes": 146492 },
  "faces": ["WithMe Sans:unloaded", "WithMe Num:unloaded"],
  "checkAfterLoad": true
}
```

- 直接 `fetch('fonts/with-me-num-400.woff2')` → 200、1776 字节；`with-me-sans-var.woff2` → 200、146492 字节。两个 woff2 都在 `app.asar.unpacked/dist/renderer/fonts/`，**都拿得到、字节数对**。
- 此刻两个 `@font-face` 都还是 `unloaded`（页面当前没渲染到用到它们的文本，浏览器还没触发加载），所以 `document.fonts.check` 对没被用到/没加载完的字体返回 false。显式 `await document.fonts.load('12px "WithMe Num"')` 之后再 check → `true`。
- 结论：`font.num:false` 是探针里 `document.fonts.check` 的**懒加载时序假阴**（同目录同机制的 sans 能过，字节也能 fetch 到），不是 asar/unpacked 的重定向没发生。判定不因此翻成 C。（我没有为了让探针变绿去放宽断言——红的那格是另开专项脚本测出来的。）

release/win-unpacked/resources/ 实际结构（关键几行）：

```
resources/
├── app.asar                     (1,185,270 字节)
├── app.asar.unpacked/
│   ├── dist/renderer/fonts/     {with-me-num-400.woff2, with-me-sans-var.woff2}   (woff2×2)
│   ├── dist/renderer/voice/     line-001.mp3 … line-200.mp3                        (mp3×200)
│   └── skins/block/animation/   {click,drag,eat,idle,move,turn}/*.webm             (webm×8)
├── default_app.asar
├── app-update.yml
└── elevate.exe
```

`asar list app.asar` 里 `dist/**`、`skins/block/**`、`package.json` 齐全；`.webm/.mp3/.woff2` 在头里也有条目（打包器只在 header 留指针，实体内容已经搬到上面的 `app.asar.unpacked/`），与重定向实测一致。

门禁（`npm run dist`）结果，如实记：
- electron-builder 26.18.0，`electronDist` 指向本机 `node_modules/electron/dist`（未从 github 下载 Electron）。
- NSIS 二进制（nsis-3.0.4.1 / nsis-resources-3.4.1 / 7zip）由仓库 `.npmrc` 里的 `electron_builder_binaries_mirror`（npmmirror）下下来了，没卡在 github。
- `files` 白名单里的 `LICENSE`、`NOTICE.md` 目前还不存在（Task 3 落地），electron-builder 只是跳过匹配不到的 pattern，**没有**报 `no files matched` 硬错——所以这两行保持原样，无需注释，Task 3 落文件后自动进包。
- 第一次 `npm run dist` 我这边踩到了本机文件锁连环（详见报告），一度在 NSIS 卸载器那步报 `spawn UNKNOWN`。清干净后在**无锁冲突**的输出目录重跑，`electron-builder --win`（nsis+zip 两个 target）**退出码 0**，五件套齐全：
  ```
  release/with-me-0.1.0-setup.exe        (135,528,660 字节)
  release/with-me-0.1.0-portable.zip     (167,502,917 字节)
  release/win-unpacked/with-me.exe       (249,789,440 字节)
  release/win-unpacked/resources/app.asar
  release/win-unpacked/resources/app.asar.unpacked/   (webm×8 / mp3×200 / woff2×2)
  另有 with-me-0.1.0-setup.exe.blockmap、latest.yml
  ```

## 这条判定决定了什么
- A：electron-builder.yml 保持 `asar:true` + asarUnpack 三条 glob（`**/*.webm`、`**/*.mp3`、`**/*.woff2`），协议层不动。Task 2 按 A 收口。
- B：（未触发）改 asar:false 那套不需要。
- C：（未触发）不需要在 `mapAppPath` 之后加 unpacked 改写。

实测的 webm/mp3/woff2 都经由 `app.asar.unpacked` 流出来了，正是 A 的假设成立——`net.fetch(pathToFileURL(app.asar/…))` 会自动落到 `app.asar.unpacked/…`，Range 分段也照常（webm 能解帧、mp3 能出时长就是证据）。

## 为什么不能照抄 qqpet
它是 `asar:true`，但重素材走 `extraResources` 落在 asar **外面**，asar 里只有代码——它没回答「大媒体在 asar 内被 `net.fetch` 分段读」这个问题。我们这边大媒体是 `asarUnpack` 搬进 `app.asar.unpacked`（不是 extraResources 的 `resources/` 根），路径主机是 `app://skin/…`、`app://assets/renderer/voice/…`，和 qqpet 不是同一条读法，所以必须实测。实测过了：unpacked 重定向确实发生，判定 A。
