# 装机产物的 asar 判定（2026-11-11）

分支：**A**（asar:true + asarUnpack 三条 glob 就够，`net.fetch` 走通了 `app.asar.unpacked` 的重定向；协议层不动）

命令：`npm run dist` → `node e2e/package-check.mjs`

> 关于跑法的重要说明：本机装了 Device Guard / 智能应用控制，会**拒绝执行改名后的未签名 `release/win-unpacked/with-me.exe`**（直接跑报 “已被你的组织的 Device Guard 代码保护阻止”；playwright `electron.launch` 因此报 “Process failed to launch!”，且会泄漏一条异步 unhandledRejection 把 node 进程打死，所以「先试装机 exe、失败再自动回退」这种双启动在本机不可靠）。这不是打包坏了，是本机安全策略拦 exe。
>
> `e2e/package-check.mjs` 因此**默认**改用**有信誉的** `node_modules/electron/dist/electron.exe` 直接加载**同一份构建产物** `release/win-unpacked/resources/app.asar`（旁边就是它的 `app.asar.unpacked`）：`electron.exe app.asar` 与装机 exe 走的是同一套 asar→unpacked 重定向，with-me.exe 只是 electron.exe 的改名版，产物完全同一份。断言逐条照抄、一条没放宽，只换了启动方式。脚本首行会打印本次用的是哪条路。
> 在能直接跑装机 exe 的机器 / CI 上，设 `PKG_PROBE_EXE=1` 即改打真正的 `with-me.exe`（`args: []`）。**下面的 JSON 就是 `node e2e/package-check.mjs`（默认 asar 等价路）这次真打印的，任何人 clone 仓库、`npm run dist` 后跑同一条命令都能复现。**

实测输出（`node e2e/package-check.mjs` 原样打印，字体那格见下方说明）：

```
探针启动方式：electron.exe + app.asar（等价回退）.../release/win-unpacked/resources/app.asar
打包产物验证通过 {
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
  "font": [
    {
      "family": "WithMe Sans",
      "url": "app://assets/renderer/fonts/with-me-sans-var.woff2",
      "status": 200,
      "byteLength": 146492,
      "checkAfterLoad": true
    },
    {
      "family": "WithMe Num",
      "url": "app://assets/renderer/fonts/with-me-num-400.woff2",
      "status": 200,
      "byteLength": 1776,
      "checkAfterLoad": true
    }
  ]
}
```

第 1 层（代码在 asar 内）：绿。`location.href === app://assets/renderer/index.html`，`__petDebug` 到位，`pageErrors` 空。
第 2 层（媒体在 asar 外）：**全绿**。
- webm：绿。`video.is-front` 解出真实画面 640×360，src 是 `app://skin/click/tapped.webm`——这个文件就在 `app.asar.unpacked/skins/block/animation/click/`，说明 `net.fetch` 跟着重定向读到了 unpacked。
- 语音：绿。`voice/manifest.json` 取回 200 / 27469 字节（数组形状，首条 `file` 带 `voice/` 前缀，和真实样例一致）；`voice/line-001.mp3` 出时长 5.808s，mp3 也在 `app.asar.unpacked/dist/renderer/voice/`。
- 字体：绿。两支 woff2 都 `status:200`、字节数 > 0（sans 146492 / num 1776），且 `document.fonts.load` 之后 `checkAfterLoad` 为 `true`。

字体这一格为什么从旧版的 `num:false` 变成现在全绿（判据修对了，不是运气）：

- **旧判据问错了问题**：旧脚本只 `await document.fonts.ready` 再 `document.fonts.check('12px "WithMe Num"')`。`fonts.check` 测的是「DOM 现在用没用到、加载没加载这支字体」，而 `'WithMe Num'` 只被 `.pet-float`（飘字 +N，`src/renderer/style.css:425-434`）消费，探针看到的默认待机画面里根本没有这个元素，那条 `@font-face` 从不触发加载 → check 恒 false。这是假阴，不是环境/asar 问题。
- **新判据测「app:// 供得出 + 装得上」**：从 CSS 的 `@font-face` 规则里读出 family 名和 `src` 的 url（文件名以 `style.css` 为唯一真相，探针不写死），对每支 woff2 先 `fetch` 断言 200 且字节 > 0，再 `await document.fonts.load(...)` 之后断言 `check` 为 true。sans / num 两支都覆盖。
- **反向对照**：临时往判据里塞一支包里根本没有的 `fonts/no-such-font.woff2`，脚本变红退出（`AssertionError ... status:404`）；删掉临时那段后重跑恢复绿。证明这一层真在测「app:// 取不取得到 woff2」，红/绿随判据而非随环境。详见 Fix round 1 报告一节。

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

## 还没验过的一格（交真机）

本机 Device Guard 拦未签名 exe，所以 `release/win-unpacked/with-me.exe` **至今没被执行过**：
判定 A 的证据来自「有信誉的 `electron.exe` + 同一份 `app.asar`/`app.asar.unpacked` + 同一套断言」。
这两条路在 `app.getAppPath()` 上同解（`src/main` 里没有 `app.isPackaged` 分支），
但**「双击装好的 exe 能不能跑起来」这一格仍是空的**，只能在没被策略拦的机器上勾：

    PKG_PROBE_EXE=1 node e2e/package-check.mjs   # 期望退出码 0，首行打印「装机 exe」那条路

### 勾这一格之前先知道的两件事（Task 2 收口）

- `PKG_PROBE_EXE` 现在只接受 `'0'` / `'1'`：设成别的值（CI 里写 `true` 之类）脚本立刻
  `exit 2` 并报 `PKG_PROBE_EXE 只接受 '0' 或 '1'`，**不会**静默落回等价路。也就是说
  「首行打印哪条路」这句验收话现在是真的可判定的。
- `publish: null` 已生效：`npm run dist` 不再产出 `release/latest.yml`（v1 不做自动更新，
  留着等于对外宣称有更新源）。上面门禁一节里那句「另有 …latest.yml」是 Task 1 当时的实测记录，
  保留作历史；现阶段 `npm run dist` 的产物是 `with-me-0.1.0-setup.exe` + `.blockmap`、
  `with-me-0.1.0-portable.zip`、`win-unpacked/`，**没有 `latest.yml`**。

## Task 2 实测补记（2026-11-12，本机）

`publish: null` 生效，实测证据：全量构建（`--win`，nsis+zip 两个 target）落到 `release-pub2/` 的产物是

```
builder-debug.yml
win-unpacked/
with-me-0.1.0-portable.zip      167,502,687 B
with-me-0.1.0-setup.exe             189,756 B   ← 壳，见下
```

**没有 `latest.yml`**（Task 1 那轮的门禁记录里有它，那时还没关 publish）。
探针对着 `release-pub2/win-unpacked` 跑：退出码 0，mp3 `duration: 5.808`，两支 woff2 `status: 200`
（146,492 / 1,776 B）。

### 本机出不了可用的安装包

`building target=nsis` 走到 `spawn UNKNOWN`，对象是 electron-builder 自己临时目录里的
`%TEMP%\t-xxxx\elevate-staging-1\resources\elevate.exe`——一个刚写出来的未签名 exe。
和拦 `with-me.exe` 的是同一套策略（Device Guard / 智能应用控制）。后果是 `setup.exe` 只落了 189 KB 的壳，
**这台机器不能作为安装包的验收地点**：安装包由 CI（`windows-latest`，无此策略）出，本机只验 `zip` + `win-unpacked`。
将来若要在本机补这一格，做法是给 NSIS 用的临时目录加白，或换台没装策略的机器。

### 反向对照两条（都是真跑的）

1. `PKG_PROBE_EXE=true node e2e/package-check.mjs` → 打印 `PKG_PROBE_EXE 只接受 '0' 或 '1'，收到 "true"`，`exit=2`。
   没有静默落回等价路。
2. 把 `src/renderer/style.css` 里 `'WithMe Num'` 的 url 临时改成 `fonts/nope-404.woff2`，重打进独立目录后跑探针：

```
AssertionError: woff2 经 app:// 取不到（第 2 层媒体没流出来）：
{"family":"WithMe Num","url":"app://assets/renderer/fonts/nope-404.woff2","status":404,
 "byteLength":9,"loadError":"NetworkError: A network error occurred.","checkAfterLoad":false}
actual: 404, expected: 200    exit=1
```

   逐支兜 `document.fonts.load` 的效果就在这条输出里：报的是「哪一支、取到什么状态、load 说了什么」，
   不是一句裸网络错误，而且另一支 Sans 照常验完。改回 url 重打 → `exit=0`。

### 为什么探针多了个 `PKG_PROBE_ROOT`

反向对照要「改点东西重打一次」，而 electron-builder 每次先清空它的输出目录。
直接往 `release/` 里 `--win dir` 重来，中途撞上 `EBUSY`（`default_app.asar` 被 AV 句柄占着）
就把真产物掏成了半个目录——`win-unpacked` 只剩 `resources/`，随后那次探针超时**不作数**。
所以反向对照一律：

```bash
npx electron-builder --win dir --config.directories.output=release-rc --config.electronDist=node_modules/electron/dist
PKG_PROBE_ROOT=release-rc/win-unpacked node e2e/package-check.mjs
```

**遗留（环境，不是代码）**：本仓库根下的 `release/`、`release_fresh/`、`release_verify/` 各有 asar
删不掉（`rm` 报 `Device or resource busy`，进程表里查不到持有者，判定为杀软 minifilter）。
下次跑 `npm run dist` 前先重启，或者照上面用 `--config.directories.output=<临时目录>`。
