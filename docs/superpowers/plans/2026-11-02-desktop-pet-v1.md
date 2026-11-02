# 桌宠 v1（Windows）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 桌面上跑起一只可自定义皮肤的宠物：它站在屏幕里按规则随机播放动画，鼠标悬停 400 毫秒弹出按钮面板，点按钮切换动作，其余区域鼠标完全穿透。

**Architecture:** Electron 双进程。主进程只做四件事（建窗、鼠标穿透开关、光标轮询推进、焦点切换），全部业务语义在渲染层：皮肤校验、命中判定、悬停计时、行为调度、播放器抽象。皮肤是外置目录（manifest + 一段动作一个 webm），程序不认角色名只认包。

**Tech Stack:** Node 22+、TypeScript 5.5、Electron、vitest（纯逻辑单测）、Playwright 的 Electron 驱动（集成测试）、ffmpeg-static（仅开发期生成占位素材与体检）。

**Spec:** `docs/桌宠-Windows实现方案.html`（仓库内副本；`E:\ai-pet\桌宠-Windows实现方案.html` 是同一份的原件。本计划实现它的第一版范围）

## Global Constraints

每个任务的隐含要求，逐条来自设计文档：

- 平台：Windows 10/11 x64 先交付；macOS 只允许出现在 `src/main/platform.ts` 的接口形状里，业务代码不许出现 `if (process.platform === ...)`。
- **禁止调用 `app.disableHardwareAcceleration()`**。本项目的核心赌注是保留硬件加速 + 整屏透明窗（设计文档第 3、10 节）。Task 3 的 spike 负责证伪或证实。
- 不使用 React/Vue/Svelte、不使用游戏引擎、不使用 Tauri/Qt。界面用手写 DOM + TypeScript。
- 运行期依赖白名单：`electron`（dev）。发布期依赖（`electron-builder`）不在本计划内。生产代码零第三方运行时依赖。
- 开发依赖白名单：`typescript`、`vitest`、`playwright`、`ffmpeg-static`、`@types/node`。
- 素材规格：画布 640×360，脚底基准线 y=330，VP9 + alpha 的 `.webm`，蓝幕 `#0000FF` 抠像，`-crf 8 -b:v 0 -auto-alt-ref 0`。
- 每段动画的首帧与末帧必须是同一标准正面姿势（素材合同）。
- 动画一律按**名字**寻址，禁止数组下标寻址（`ordinal` 反模式）。
- 一个常量/决策只活在一个地方。所有时间参数集中在 `src/shared/config.ts`，禁止散落字面量。
- 存档目录走 `platformDataDir()` 函数，禁止硬编码 `%APPDATA%`。
- 不搬运任何第三方美术素材（dsh-pet、qqpet、indesktop 的图与视频一律不用）。
- 提交节奏：每个任务的每个 Step 通过测试后单独提交，提交信息用 `type: 中文说明`。
- **所有相对 import 必须带 `.js` 后缀**（`import { x } from './config.js'`），包括测试文件里 import 源码。项目是 Node ESM（`"type": "module"` + `moduleResolution: NodeNext`），无后缀的相对路径在运行时直接报错。本文档各代码片段为节省篇幅偶有省略，落地时必须补上，`npm run typecheck` 会把漏掉的抓出来。
- 仓库根：`E:\ai-pet\with-me`（Git 仓库已初始化，分支 `main`，远程 `origin` = https://github.com/Hsiaoder/with-me.git，私有）。
- 参考项目在 `E:\ai-pet\demo-project\`，**在仓库之外**，只读；任何任务都不许修改它，也不要把它提交进仓库。
- 设计与计划文档的仓库内路径：`docs/桌宠-Windows实现方案.html`、`docs/superpowers/plans/2026-11-02-desktop-pet-v1.md`，Task 1 的首个提交把它们收进版本历史。

---

## 文件结构

```
E:\ai-pet\with-me\
  package.json  tsconfig.json  vitest.config.ts  .gitignore
  docs/桌宠-Windows实现方案.html                    设计文档（为什么这样选）
  docs/架构大纲.md                                  结构总纲（由哪几块组成、各用什么技术）
  docs/superpowers/plans/2026-11-02-desktop-pet-v1.md   本计划
  skins/block/                 内置色块皮肤（占位动画 + manifest）
    manifest.json
    animation/idle/a1.webm ... drag/pull.webm
  tools/
    make-test-skin.mjs         用 ffmpeg-static 生成占位动画（开发期工具）
    alpha-report.mjs           透明通道残留体检（皮肤校验用）
  src/
    shared/                    纯逻辑，无 Electron 无 DOM，vitest 覆盖
      config.ts                所有时间/尺寸常量（唯一来源）
      types.ts                 Rect/Point/Box/AnimationName 等
      ipc.ts                   IPC 消息名与 payload 类型（唯一消息表）
      geometry.ts              canvas→屏幕矩形换算、命中判定
      hover.ts                 悬停停留/释放计时（纯状态机）
      lease.ts                 鼠标穿透租约状态机（纯，含超时兜底）
      behavior.ts              随机层：加权抽取、排除重复
      rules.ts                 规则层：状态转换
      skin.ts                  manifest 类型 + 校验
      save.ts                  存档类型 + version + 迁移入口
    main/
      index.ts                 app 生命周期，装配
      platform.ts              四个动作：建窗/穿透/光标推进/焦点
      windows.ts               整屏覆盖窗的创建参数
      protocol.ts              app:// 协议：把 dist 与皮肤目录映射成同源 URL
      clickthrough.ts          用 lease.ts 驱动 setIgnoreMouseEvents
      cursor.ts                33ms 光标轮询
      fullscreen.ts            全屏应用探测与让路
      storage.ts               save.json 读写 + .bak 备份
      paths.ts                 platformDataDir()
      ipc.ts                   消息注册（薄胶水，无逻辑）
    preload/
      index.cjs                window.petBridge 白名单（零 import，通道名内联）
    renderer/
      index.html
      main.ts                  装配：皮肤→播放器→行为→交互→面板
      sprite.ts                宠物元素与位置
      panel.ts                 悬停面板 DOM 与按钮
      player/clip-player.ts    ClipPlayer 接口与类型
      player/video-backend.ts  双 video A/B 实现（四铁律）
      player/fake-backend.ts   测试用假实现
  spike/                       一次性验证代码，不进生产，README 标注丢弃
  test/                        vitest 单测（与 src 目录镜像）
  e2e/                         Playwright Electron 测试
  docs/superpowers/plans/      本文件
```

---

## Task 1: 仓库与工具骨架

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/shared/config.ts`, `test/config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `npm run test`（vitest run）、`npm run typecheck`（tsc --noEmit）、`src/shared/config.ts` 里所有后续任务要用的常量名。

- [ ] **Step 1: 确认仓库就绪并装依赖**

仓库已初始化（`E:\ai-pet\with-me`，分支 `main`，远程 `origin`），**不要再跑 `git init`**。

```bash
cd /e/ai-pet/with-me
git status --short          # 预期只看到 docs/ 两个未跟踪文件
npm init -y
npm i -D typescript vitest playwright jsdom ffmpeg-static @types/node
npx tsc --init --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --outDir dist
```

`package.json` 的 `scripts` 改成：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "dev": "electron dist/main/index.js",
    "build": "tsc"
  },
  "type": "module"
}
```

- [ ] **Step 2: 写 .gitignore**

```
node_modules/
dist/
spike/out/
*.log
.save.json.bak.tmp
```

- [ ] **Step 3: 写 vitest.config.ts，让单测只跑纯逻辑**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: 写 src/shared/config.ts（全局唯一常量来源）**

设计文档里出现的每个数字都在这一个文件里，后续任务只 import，不再写字面量。

```ts
/** 全局唯一的尺寸与时间常量。设计文档第 3、4、9 节的数值在此落地。 */

// 素材合同
export const CANVAS_W = 640;
export const CANVAS_H = 360;
export const FEET_Y = 330;                 // 脚底基准线（画布坐标）
export const STAGE_W_CSS = 320;            // 宠物在屏幕上的显示宽度（CSS 像素）
export const STAGE_H_CSS = STAGE_W_CSS * CANVAS_H / CANVAS_W;  // 16:9

// 鼠标与悬停
export const CURSOR_POLL_MS = 33;          // 主进程推进光标的间隔
export const HOVER_DWELL_MS = 400;         // 停留满 400ms 才弹面板
export const HOVER_RELEASE_MS = 400;       // 离开 400ms 才收面板并恢复穿透
export const LEASE_TIMEOUT_MS = 500;       // 穿透租约超时兜底

// 存档
export const SAVE_VERSION = 1;
export const SAVE_FILE = 'save.json';

// 皮肤
export const SKIN_MANIFEST = 'manifest.json';
export const REQUIRED_POOLS = ['idle', 'turn', 'move', 'click', 'drag'] as const;
```

- [ ] **Step 5: 写第一个测试并让它失败**

```ts
// test/config.test.ts
import { describe, it, expect } from 'vitest'
import { CANVAS_W, CANVAS_H, STAGE_W_CSS, STAGE_H_CSS } from '../src/shared/config'

describe('素材合同', () => {
  it('画布是 16:9', () => {
    expect(CANVAS_W / CANVAS_H).toBeCloseTo(16 / 9, 6)
  })
  it('舞台高度按 16:9 从宽度推导，不写死', () => {
    expect(STAGE_H_CSS).toBeCloseTo(STAGE_W_CSS * 9 / 16, 6)
  })
})
```

Run: `npm run test`
Expected: 两个用例 PASS（常量已定义）。这一步的意义是让 `npm run test` 和 `npm run typecheck` 从此可用。

- [ ] **Step 6: 校验并提交**

```bash
npm run typecheck && npm run test
git add .gitignore package.json package-lock.json tsconfig.json vitest.config.ts src/shared/config.ts test/config.test.ts docs/
git commit -m "chore: 初始化 TypeScript + vitest 骨架，并收录设计文档与实现计划"
```

---

## Task 2: 占位动画与透明通道体检

没有带 alpha 的 webm，spike 和皮肤都跑不起来。机器上没有 ffmpeg，所以用 `ffmpeg-static` 提供的二进制；顺带用真实管线（蓝幕 → 抠像 → 编码）生成色块皮肤，一次验证设计文档第 6 节的三个坑。

**Files:**
- Create: `tools/make-test-skin.mjs`, `tools/alpha-report.mjs`, `skins/block/manifest.json`（占位，Task 5 补全字段）, `test/alpha-report.test.ts`

**Interfaces:**
- Consumes: `src/shared/config.ts` 的 `CANVAS_W/CANVAS_H`
- Produces: `skins/block/animation/<pool>/<name>.webm`（6 段真实带 alpha 视频）；`analyzeAlpha(rgba: Uint8Array): AlphaReport`（供 Task 5 皮肤校验调用）

- [ ] **Step 1: 写生成占位动画的脚本**

关键：用 `colorkey` 滤镜把蓝幕变透明（这就是真实管线的抠像步骤），解码/编码两端都显式写 `libvpx-vp9` + `format=yuva420p`，否则透明通道会被静默丢掉。

```js
// tools/make-test-skin.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import ffmpegPath from 'ffmpeg-static'

const FFM = ffmpegPath
const W = 640, H = 360, FPS = 24, DUR = 4
const BLUE = '0x0000FF'
const GLOW = '0x2CE68A'   // 角色发光件的颜色，故意不用绿幕色，验证蓝幕安全性

// 每段动画：池 / 名字 / 画面差异（drawbox 的位置表达式）
const CLIPS = [
  ['idle',  'patrol',  '200+40*sin(2*PI*t/2)'],
  ['idle',  'patrol2', '200+40*cos(2*PI*t/2)'],
  ['turn',  'left',    '200'],
  ['move',  'step',    '200+90*sin(2*PI*t/4)'],
  ['click', 'tapped',  '200'],
  ['drag',  'pulled',  '200'],
]

function make([pool, name, xExpr]) {
  const out = `skins/block/animation/${pool}/${name}.webm`
  mkdirSync(`skins/block/animation/${pool}`, { recursive: true })
  const vf =
    // 1) 蓝底  2) 画一个会动的色块当角色  3) 抠掉蓝幕 → 产生 alpha
    // 4) 强制 yuva420p（不写会丢 alpha）
    `drawbox=x='${xExpr}':y='50':w='240':h='280':color=${GLOW}:t=fill` +
    `,colorkey=${BLUE}:0.30:0.05` +
    `,format=yuva420p`
  execFileSync(FFM, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${BLUE}:s=${W}x${H}:d=${DUR}:r=${FPS}`,
    '-vf', vf,
    '-c:v', 'libvpx-vp9',        // 编码端显式 VP9
    '-crf', '8', '-b:v', '0',
    '-auto-alt-ref', '0',
    '-row-mt', '1',
    '-an', out,
  ], { stdio: 'inherit' })
  console.log('ok', out)
}

CLIPS.forEach(make)
```

Run: `node tools/make-test-skin.mjs`
Expected: 打印 6 行 `ok skins/block/animation/...webm`，每个文件约 30–120 KB。

- [ ] **Step 2: 手写失败测试，定 AlphaReport 的形状**

体检的判据来自设计文档第 5 节：背景区（身体矩形之外）不该有可见残留。

```ts
// test/alpha-report.test.ts
import { describe, it, expect } from 'vitest'
import { analyzeAlpha } from '../tools/alpha-report.mjs'

// 构造 4x2 的 RGBA 帧：左侧 2 列是身体（不透明），右侧 2 列是背景
const body = 255, bg = 0
const frame = new Uint8Array([
  10,10,10,body, 10,10,10,body, 0,0,0,bg, 0,0,0,bg,
  10,10,10,body, 10,10,10,body, 0,0,0,bg, 0,0,0,bg,
])

describe('analyzeAlpha', () => {
  it('统计背景区的 alpha 分布', () => {
    const r = analyzeAlpha(frame, 4, 2, { x: 0, y: 0, w: 2, h: 2 })  // bodyBox 只占左半
    expect(r.bgSamples).toBe(4)
    expect(r.bgAlphaMax).toBe(0)
    expect(r.bgAlphaMean).toBe(0)
  })
  it('背景残留超过阈值时报警告', () => {
    const hazy = new Uint8Array(frame); hazy[7] = 30          // 背景某像素 alpha=30
    hazy[15] = 20
    const r = analyzeAlpha(hazy, 4, 2, { x: 0, y: 0, w: 2, h: 2 })
    expect(r.bgAlphaMax).toBe(30)
    expect(r.haze).toBe(true)                                  // 超过 BG_ALPHA_WARN=8
  })
})
```

Run: `npm run test -- alpha`
Expected: FAIL —「Cannot find module .../alpha-report.mjs」

- [ ] **Step 3: 实现体检函数**

```js
// tools/alpha-report.mjs
/** 背景区（身体矩形之外）的 alpha 高于此值即视为灰雾残留。 */
export const BG_ALPHA_WARN = 8

/**
 * 只看 alpha 通道，判断抠像是否干净。
 * @param rgba 整帧 RGBA 字节
 * @param w 帧宽
 * @param h 帧高
 * @param body 身体矩形（像素坐标），框内算身体，框外算背景
 */
export function analyzeAlpha(rgba, w, h, body) {
  let n = 0, sum = 0, max = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBody = x >= body.x && x < body.x + body.w && y >= body.y && y < body.y + body.h
      if (inBody) continue
      const a = rgba[(y * w + x) * 4 + 3]
      n++; sum += a; if (a > max) max = a
    }
  }
  const mean = n === 0 ? 0 : sum / n
  return { bgSamples: n, bgAlphaMean: mean, bgAlphaMax: max, haze: max > BG_ALPHA_WARN }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test -- alpha`
Expected: 2 passed

- [ ] **Step 5: 给体检加命令行入口，并用它验真实产物**

```js
// 追加到 tools/alpha-report.mjs 末尾
if (process.argv[1] && process.argv[1].endsWith('alpha-report.mjs')) {
  const { execFileSync } = await import('node:child_process')
  const { default: ffmpegPath } = await import('ffmpeg-static')
  const file = process.argv[2]
  const body = JSON.parse(process.argv[3] ?? '{"x":200,"y":50,"w":240,"h":285}')
  // 解码端显式 libvpx-vp9，否则 alpha 位流被丢，体检结果全是假阳性
  const raw = execFileSync(FFM_BIN, [
    '-v', 'error', '-c:v', 'libvpx-vp9', '-i', file,
    '-vf', `select=eq(n\\,0)`, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { maxBuffer: 64 * 1024 * 1024 })
  const r = analyzeAlpha(raw, 640, 360, body)
  console.log(file, JSON.stringify(r))
  if (r.haze) process.exitCode = 1
}
```

把脚本顶部改为同时导出常量供上面使用：

```js
const FFM_BIN = (await import('ffmpeg-static')).default
```

Run: `node tools/alpha-report.mjs skins/block/animation/idle/patrol.webm`
Expected: 打印形如 `{"bgSamples":172800,"bgAlphaMean":< 1,"bgAlphaMax":<8,"haze":false}`，退出码 0。若 `haze:true`，说明 `colorkey` 的容差（0.30）太宽，调小到 0.20 重跑第 1 步。

- [ ] **Step 6: 写皮肤占位 manifest，让 Task 5 有东西可装载**

```json
{
  "formatVersion": 1,
  "name": "色块",
  "canvas": { "w": 640, "h": 360, "feetY": 330 },
  "bodyBox": { "x": 200, "y": 50, "w": 240, "h": 285 },
  "pools": {
    "idle":  ["patrol", "patrol2"],
    "turn":  ["left"],
    "move":  ["step"],
    "click": ["tapped"],
    "drag":  ["pulled"]
  }
}
```

- [ ] **Step 7: 提交**

```bash
git add tools/ skins/
git commit -m "feat: 蓝幕抠像生成占位动画，并加入透明通道残留体检"
```

---

## Task 3: Spike — 整屏透明窗 + 硬件加速四步验证

**一次性验证，不是生产代码。** 目标是回答设计文档第 3 节那个尚未证实的问题：整屏透明覆盖层 + 保留硬件加速 + 带 alpha 的 webm，在真机上是否成立。结论无论正反都要写进 `spike/README.md`，因为它决定后续任务是走覆盖层还是走「固定尺寸单窗」退路。

**Files:**
- Create: `spike/main.mjs`, `spike/index.html`, `spike/README.md`
- Modify: `docs/桌宠-Windows实现方案.html`（把结论写回第 3 节）

**Interfaces:**
- Consumes: `skins/block/animation/idle/patrol.webm`、npm 已装的 `electron`
- Produces: 结论记录（无代码接口）

- [ ] **Step 1: 写 spike 主进程（刻意不调 disableHardwareAcceleration）**

```js
// spike/main.mjs
import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))

// 硬件加速保持开启 —— 这是被验证项，动它就失去意义
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

await app.whenReady()

const win = new BrowserWindow({
  ...screen.getPrimaryDisplay().workArea,
  show: false, frame: false, transparent: true, hasShadow: false,
  resizable: false, movable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true,
  webPreferences: { preload: join(here, 'preload.mjs'), contextIsolation: true, sandbox: false },
})
win.setAlwaysOnTop(true, 'screen-saver')
win.setIgnoreMouseEvents(true)
win.once('ready-to-show', () => win.showInactive())
await win.loadFile(join(here, 'index.html'))

let grabbed = false
ipcMain.on('spike:grab', (_e, on) => {
  if (on === grabbed) return
  grabbed = on
  win.setIgnoreMouseEvents(!on)
})
```

```js
// spike/preload.mjs
import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('spike', { grab: (on) => ipcRenderer.send('spike:grab', on) })
```

```html
<!-- spike/index.html -->
<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden}
  #pet{position:absolute;left:400px;top:300px;width:320px;height:180px}
  video{width:100%;height:100%;object-fit:contain}
  #tip{position:fixed;left:400px;top:480px;font:14px sans-serif;color:#123}
</style></head><body>
  <div id="pet"><video autoplay loop muted playsinline src="../skins/block/animation/idle/patrol.webm"></video></div>
  <div id="tip">光标：—</div>
  <script>
    // 用主进程推进的光标做命中判定：光标落在宠物矩形内就请求接住鼠标
    const W = 320, H = 180; let x = 400, y = 300
    setInterval(async () => {
      const p = await window.spikeCursor?.()      // 见 Step 2 的注入
      if (!p) return
      const inside = p.x >= x && p.x <= x + W && p.y >= y && p.y <= y + H
      document.getElementById('tip').textContent =
        `光标 ${p.x},${p.y} ${inside ? '在宠物上（接住）' : '在外部（穿透）'}`
      window.spike.grab(inside)
    }, 33)
  </script>
</body></html>
```

- [ ] **Step 2: 补上光标推进这条通道（spike 里最简版）**

`preload.mjs` 加：

```js
contextBridge.exposeInMainWorld('spikeCursor', () => ipcRenderer.invoke('spike:cursor'))
```

`main.mjs` 加：

```js
import { screen as elecScreen } from 'electron'
ipcMain.handle('spike:cursor', () => {
  const c = elecScreen.getCursorScreenPoint()
  const b = win.getBounds()
  return { x: c.x - b.x, y: c.y - b.y }
})
```

- [ ] **Step 3: 跑起来，按设计文档第 3 节的四步逐项观察**

```bash
npx electron spike/main.mjs
```

观察并记录：
1. **边缘**：色块四周有没有灰色/蓝色雾、有没有黑边、整屏有没有一块矩形底。
2. **流畅**：让它跑 10 分钟，任务管理器看 CPU 与内存是否稳定（记下百分比）。
3. **穿透**：光标在宠物外时点击桌面图标能正常打开；移到色块上时面板文字变「接住」，此时点击落到宠物区域内不穿透。
4. **让路**：开一个全屏视频和一个全屏游戏，看宠物是否盖在上面（这一步现在还没实现让路，**预期结果就是盖住**，记录下来供 Task 13 验证修复）。

- [ ] **Step 4: 把结论写进 spike/README.md，并回写设计文档**

`spike/README.md` 必须包含：日期、机器与系统版本、GPU 型号、四步各自的实测结果、CPU/内存数字、结论三选一（**通过 / 需带限制通过 / 不通过走退路**）。不通过时退路内容写清楚：改成「一宠一窗、窗口一次性按最大尺寸建立、永不改大小」，命中判定改搬 `demo-project/dsh-pet/dsh-pet/runtime/electron-helper/pointer-target.js` 的三态函数。

- [ ] **Step 5: 提交（spike 允许提交，但目录名已隔离）**

```bash
git add spike/ docs/桌宠-Windows实现方案.html
git commit -m "spike: 整屏透明窗与硬件加速四步实测结论"
```

---

## Task 4: 消息表、平台层与主进程骨架

从这里开始是生产代码。平台层只暴露四个动作，业务代码之后一律不碰 Electron 的窗口 API。

**Files:**
- Create: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/main/platform.ts`, `src/main/windows.ts`, `src/main/protocol.ts`, `src/main/cursor.ts`, `src/main/clickthrough.ts`, `src/main/ipc.ts`, `src/preload/index.cjs`, `src/main/index.ts`, `test/ipc-types.test.ts`, `test/protocol-path.test.ts`
- Modify: `package.json`（加 `dev:app` 脚本）

**Interfaces:**
- Consumes: `src/shared/config.ts`
- Produces:
  - `type Rect = { x: number; y: number; w: number; h: number }`、`type Point = { x: number; y: number }`（`src/shared/types.ts`）
  - `IPC` 常量表（`src/shared/ipc.ts`）：
    `cursor`（main→renderer，payload `Point`）、
    `click-through-request`（renderer→main，payload `{ grab: boolean }`）、
    `focusable`（renderer→main，payload `boolean`）、
    `debug-overlay`（renderer→main，payload `boolean`）、
    `skin-loaded`（main→renderer，payload `LoadedSkin | { errors: string[] }`）
  - `interface Platform { createWindow(): void; setInteractive(on: boolean): void; sendCursor(p: Point): void; setFocusable(on: boolean): void; show(): void; hide(): void }`
  - `createWindowsPlatform(opts): Platform`

- [ ] **Step 1: 写类型与消息表**

```ts
// src/shared/types.ts
export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type Box = Rect   // 画布坐标下的矩形，语义上是「身体占的位置」

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}
```

```ts
// src/shared/ipc.ts
/** 消息名与 payload 的唯一来源。新增通道只改这里。 */
export const IPC = {
  cursor: 'pet:cursor',                        // main → renderer
  clickThroughRequest: 'pet:click-through',    // renderer → main { grab }
  focusable: 'pet:focusable',                  // renderer → main boolean
  debugOverlay: 'pet:debug-overlay',           // renderer → main boolean
  skinLoaded: 'pet:skin-loaded',               // main → renderer LoadedSkin | { errors }
} as const

export type CursorPayload = Point
export type ClickThroughPayload = { grab: boolean }

import type { Point } from './types'
```

- [ ] **Step 2: 写一个失败测试，锁住消息表不与 payload 脱节**

```ts
// test/ipc-types.test.ts
import { describe, it, expect } from 'vitest'
import { IPC } from '../src/shared/ipc'

describe('消息表', () => {
  it('四条通道名字互不重复且都带 pet: 前缀', () => {
    const names = Object.values(IPC)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n.startsWith('pet:')).toBe(true)
  })
})
```

Run: `npm run test -- ipc` → Expected: PASS（此测试的作用是防止后续任务私自加散落的字符串频道）

- [ ] **Step 3: 平台层接口**

```ts
// src/main/platform.ts
import type { Point } from '../shared/types'

/** 平台层的全部能力。业务代码只认这四个动作。 */
export interface Platform {
  createWindow(): void
  setInteractive(on: boolean): void       // true=接住鼠标（关闭穿透）
  sendCursor(p: Point): void
  setFocusable(on: boolean): void
  show(): void
  hide(): void
}
```

```ts
// src/main/windows.ts
import { BrowserWindow, screen } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ORIGIN } from '../shared/config'

const here = dirname(fileURLToPath(import.meta.url))   // 运行时是 dist/main

/** 整屏覆盖窗：尺寸 = 主屏工作区，永不移动、永不改大小。 */
export function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...screen.getPrimaryDisplay().workArea,
    show: false, frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),   // 见 Task 4 Step 6：preload 是零 import 的 cjs
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.once('ready-to-show', () => win.showInactive())
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // 不能用 loadFile：Chromium 禁止 file:// 页面 import ES 模块，也会把 file:// 的视频当跨源素材。
  // 一律走 app:// 协议（Step 4b），页面与皮肤素材同源。
  void win.loadURL(`${APP_ORIGIN}renderer/index.html`)
  return win
}
```

```ts
// src/main/cursor.ts — 33ms 轮询，位置不变就不发
import type { Platform } from './platform'
import { CURSOR_POLL_MS } from '../shared/config'

export function startCursorPolling(getPoint: () => PointLike, sink: (p: PointLike) => void): () => void {
  let last: PointLike | null = null
  const t = setInterval(() => {
    const p = getPoint()
    if (last && last.x === p.x && last.y === p.y) return
    last = p
    sink(p)
  }, CURSOR_POLL_MS)
  return () => clearInterval(t)
}

import type { Point } from '../shared/types'
type PointLike = Point
```

```ts
// src/main/clickthrough.ts — 用租约状态机驱动真实窗口
import { createLease } from '../shared/lease'
import { LEASE_TIMEOUT_MS } from '../shared/config'
import type { Platform } from './platform'

/** 返回 now（毫秒）的函数由调用方注入，方便测试。 */
export function createClickThroughBridge(
  platform: Platform,
  now: () => number,
) {
  const lease = createLease({ timeoutMs: LEASE_TIMEOUT_MS, now })
  return {
    /** 渲染层的每次请求都过一次状态机，再由平台层执行。 */
    request(grab: boolean): boolean {
      const changed = lease.tick(grab)
      if (changed) platform.setInteractive(lease.interactive)
      return changed
    },
    /** 主进程侧周期性调用：租约断了就无条件恢复穿透（兜底）。 */
    sweep(): void {
      const changed = lease.sweep()
      if (changed) platform.setInteractive(lease.interactive)
    },
    state: lease,
  }
}
```

> 注意：`createLease` 在 Task 8 实现。本任务先建 `src/shared/lease.ts` 的**最小可用版本**（见 Step 4），Task 8 再补超时与测试扩展，避免此处出现未定义引用。

- [ ] **Step 4: 建最小 lease.ts 占位（有真实逻辑，可被 Task 8 扩展）**

```ts
// src/shared/lease.ts
export type LeaseOptions = { timeoutMs: number; now: () => number }

/**
 * 鼠标穿透租约。渲染层每次想要鼠标就 renew 一次；
 * 超过 timeoutMs 没有 renew，视为渲染层卡死，自动放开穿透。
 * @returns tick/sweep 返回 true 表示状态发生变化，调用方需要执行动作
 */
export function createLease(opts: LeaseOptions) {
  let held = false
  let lastRenew = 0
  return {
    get interactive() { return held },
    tick(want: boolean): boolean {
      const before = held
      if (want) { held = true; lastRenew = opts.now() }
      else held = false
      return held !== before
    },
    sweep(): boolean {
      const before = held
      if (held && opts.now() - lastRenew > opts.timeoutMs) held = false
      return held !== before
    },
  }
}
```

- [ ] **Step 4b: 注册 `app://` 协议（窗口加载和素材取用都靠它）**

为什么必须有它：Chromium 不允许 `file://` 页面 `import` ES 模块（同源策略把 file 当不透明源，报 CORS），带 alpha 的 webm 也会被当跨源素材拦。两个参考项目各有一套：qqpet 注册 `app://`，dsh-pet 注册 `dsh-pet-bridge:`。**本项目的等价物是 `src/main/protocol.ts`。**

先把路径映射写成可单测的纯函数——越界必须拒绝，而不是静默把 `..` 剥掉：

```ts
// src/main/protocol.ts
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'

export type Roots = Record<string, string>
export type Mapped = { ok: true; file: string } | { ok: false; status: 403 | 404; reason: string }

/**
 * `app:///renderer/index.html` → roots.renderer + /index.html
 * `app:///skin/idle/patrol.webm` → roots.skin + /idle/patrol.webm
 * 首段是根名，其余是相对路径。任何 `..` 直接 403；解析结果必须仍在根目录内。
 */
export function mapAppPath(roots: Roots, pathname: string): Mapped {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, '')
  const [rootName, ...rest] = clean.split('/')
  const root = roots[rootName ?? '']
  if (!root || !isAbsolute(root)) return { ok: false, status: 403, reason: `未知的资源根：${rootName}` }
  if (rest.includes('..') || clean.includes('..')) return { ok: false, status: 403, reason: '路径穿越' }
  const abs = resolve(join(root, ...rest))
  if (abs !== root && !abs.startsWith(root + sep)) return { ok: false, status: 403, reason: '解析后越出资源根' }
  if (!rest.length) return { ok: false, status: 404, reason: '缺少文件名' }
  return { ok: true, file: abs }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webm': 'video/webm', '.json': 'application/json',
  '.png': 'image/png', '.cjs': 'text/javascript; charset=utf-8',
}
/** 不给后缀猜 text/plain，宁可 404，避免把源码当页面渲染出去 */
export function mimeOf(file: string): string | null {
  return MIME[extname(basename(file)).toLowerCase()] ?? null
}
```

Electron 接线（协议必须在 ready 之前声明，handler 在 ready 之后挂）：

```ts
import { protocol } from 'electron'
import { APP_SCHEME } from '../shared/config'

export function declareAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    // stream 让 <video> 能分段读取，标准 + 安全让 ES 模块与 CSP 正常工作
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }])
}

export function attachAppHandler(roots: Roots): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const mapped = mapAppPath(roots, new URL(request.url).pathname)
    if (!mapped.ok) return new Response(mapped.reason, { status: mapped.status })
    const type = mimeOf(mapped.file)
    if (!type) return new Response('不支持的类型', { status: 404 })
    try {
      const { readFile } = await import('node:fs/promises')
      return new Response(await readFile(mapped.file), { headers: { 'content-type': type } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
```

`src/main/index.ts` 里的调用顺序（写进 Step 5 的装配）：

```ts
declareAppScheme()                        // ① 任何 await 之前
app.whenReady().then(() => {
  attachAppHandler({                      // ② ready 之后、建窗之前
    renderer: resolve('dist'),
    skin: resolve('skins/block'),
  })
  const win = createOverlayWindow()
  ...
})
```

失败测试先行：

```ts
// test/protocol-path.test.ts
import { describe, it, expect } from 'vitest'
import { mapAppPath, mimeOf } from '../src/main/protocol.js'

const roots = { renderer: '/app/dist', skin: '/data/skins/block' }

describe('mapAppPath', () => {
  it('首段选资源根，其余按相对路径拼接', () => {
    expect(mapAppPath(roots, '/renderer/index.html')).toEqual({ ok: true, file: '/app/dist/index.html' })
  })
  it('皮肤素材走 skin 根，多级子目录保留', () => {
    expect(mapAppPath(roots, '/skin/idle/patrol.webm')).toEqual({ ok: true, file: '/data/skins/block/idle/patrol.webm' })
  })
  it('路径穿越一律 403', () => {
    expect(mapAppPath(roots, '/skin/../manifest.json').ok).toBe(false)
    expect(mapAppPath(roots, '/renderer/../../etc/passwd').ok).toBe(false)
  })
  it('编码过的穿越也要挡（decodeURIComponent 之后再判）', () => {
    expect(mapAppPath(roots, '/skin/%2e%2e/%2e%2e/etc/passwd').ok).toBe(false)
  })
  it('未知资源根 403，缺文件名 404', () => {
    expect(mapAppPath(roots, '/other/x.js')).toMatchObject({ ok: false, status: 403 })
    expect(mapAppPath(roots, '/skin/')).toMatchObject({ ok: false, status: 404 })
  })
  it('mimeOf 只认白名单后缀', () => {
    expect(mimeOf('a/b.webm')).toBe('video/webm')
    expect(mimeOf('a/b.txt')).toBeNull()
  })
})
```

素材地址从此固定为 `app:///skin/<池>/<名>.webm`（Task 10 的 URL 构造照此写，不要拼 `file:///` 绝对路径——Windows 反斜杠会把它弄坏）。

Run: `npm run test -- protocol`
Expected: 先 FAIL（模块不存在），实现后 6 passed

- [ ] **Step 5: 主进程装配与 preload**

```ts
// src/main/index.ts
import { app, ipcMain, screen } from 'electron'
import { createOverlayWindow } from './windows'
import { createClickThroughBridge } from './clickthrough'
import { startCursorPolling } from './cursor'
import { loadSkin } from './skin-store'
import { IPC } from '../shared/ipc'
import { CURSOR_POLL_MS } from '../shared/config'

// 硬件加速保持开启（全局约束）。此处只允许追加 autoplay 开关。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

app.whenReady().then(() => {
  const win = createOverlayWindow()
  const platform = {
    createWindow() {},
    setInteractive(on: boolean) { win.setIgnoreMouseEvents(!on) },
    sendCursor(p: { x: number; y: number }) { win.webContents.send(IPC.cursor, p) },
    setFocusable(on: boolean) { win.setFocusable(on) },
    show() { win.showInactive() },
    hide() { win.hide() },
  }
  const bridge = createClickThroughBridge(platform, Date.now)

  ipcMain.on(IPC.clickThroughRequest, (_e, p: { grab: boolean }) => bridge.request(p.grab))
  ipcMain.on(IPC.focusable, (_e, on: boolean) => platform.setFocusable(on))
  // 兜底心跳：渲染层卡死时主进程自己把穿透放开
  setInterval(() => bridge.sweep(), CURSOR_POLL_MS).unref()

  // 窗口永不移动，所以边界只取一次。光标一律推给渲染层——穿透状态下网页
  // 收不到 mousemove，命中判定只能靠外部推进来（设计文档第 4 节）。
  const b = win.getBounds()
  startCursorPolling(
    () => {
      const c = screen.getCursorScreenPoint()
      return { x: c.x - b.x, y: c.y - b.y }
    },
    (p) => platform.sendCursor(p),
  )

  // 皮肤在主进程装载校验；失败也把错误送到渲染层，不静默
  const loaded = loadSkin('skins/block')
  win.webContents.once('did-finish-load', () => {
    win.webContents.send(IPC.skinLoaded, loaded.ok ? loaded.skin : { errors: loaded.errors })
  })
})
```

```js
// src/preload/index.mjs
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'   // 见 Step 6 的构建说明

contextBridge.exposeInMainWorld('petBridge', {
  onCursor: (cb) => ipcRenderer.on(IPC.cursor, (_e, p) => cb(p)),
  requestGrab: (grab) => ipcRenderer.send(IPC.clickThroughRequest, { grab }),
  setFocusable: (on) => ipcRenderer.send(IPC.focusable, on),
})
```

> preload 打成 `.mjs` 且需要能 import `shared`：`tsconfig.json` 里 `module: NodeNext` 时，preload 用 `.cjs` 输出更稳。改为把 preload 单独用 `esbuild` 之外零依赖方案处理 —— **本任务采用最简做法：preload 内联消息名字符串，并加一条测试断言它与 `shared/ipc.ts` 一致**（见 Step 7）。这是刻意的取舍：preload 是唯一允许重复字符串的地方，因为 `contextBridge` 的限制。

- [ ] **Step 6: 加构建脚本，让 main/preload/renderer 各出产物**

`package.json`：

```json
{
  "scripts": {
    "build": "tsc && npm run build:preload",
    "build:preload": "node tools/build-preload.mjs",
    "dev:app": "npm run build && electron dist/main/index.js"
  }
}
```

```js
// tools/build-preload.mjs — 把 preload 与其依赖打包成单个 cjs
import { build } from 'node:module'   // 见下方说明：用 esbuild 会引入依赖，这里改用 Node 自带
```

**说明与决定：** preload 需要打包器才能内联依赖，而依赖白名单里没有 esbuild。因此本计划把 preload 写成**零 import 的单文件**（消息名字符串就地内联，并由测试锁定），构建脚本只负责复制：

```js
// tools/build-preload.mjs
import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync('dist/preload', { recursive: true })
copyFileSync('src/preload/index.cjs', 'dist/preload/index.cjs')
```

`src/preload/index.cjs` 内容（无 import）：

```js
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('petBridge', {
  onCursor: (cb) => ipcRenderer.on('pet:cursor', (_e, p) => cb(p)),
  onSkin: (cb) => ipcRenderer.on('pet:skin-loaded', (_e, s) => cb(s)),
  requestGrab: (grab) => ipcRenderer.send('pet:click-through', { grab }),
  setFocusable: (on) => ipcRenderer.send('pet:focusable', on),
})
```

- [ ] **Step 7: 写锁定 preload 字符串的测试**

```ts
// test/preload-contract.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { IPC } from '../src/shared/ipc'

describe('preload 消息名与消息表一致', () => {
  it('preload 内联的每条通道都在 IPC 里存在', () => {
    const src = readFileSync('src/preload/index.cjs', 'utf8')
    const quoted = [...src.matchAll(/'((?:pet:[a-z-]+))'/g)].map((m) => m[1])
    expect(quoted.length).toBeGreaterThan(0)
    for (const q of quoted) expect(Object.values(IPC)).toContain(q)
  })
})
```

Run: `npm run test -- preload` → Expected: PASS

- [ ] **Step 8: 渲染层空壳 + 手工确认窗口能出现**

```html
<!-- src/renderer/index.html -->
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}
#root{position:relative;width:100%;height:100%}</style></head>
<body><div id="root"></div><script type="module" src="./index.js"></script></body></html>
```

```ts
// src/renderer/index.ts
const root = document.getElementById('root')!
root.textContent = ''
window.petBridge?.onCursor((p) => { /* Task 10 接线 */ })
```

Run: `npm run dev:app`
Expected: 桌面上没有可见内容（因为还没画宠物），但**鼠标一切正常**——说明整屏窗存在且穿透生效。验证方式：桌面图标仍可单击。此时不要期待任何动画。

- [ ] **Step 9: 提交**

```bash
git add src/ tools/build-preload.mjs package.json
git commit -m "feat: 整屏覆盖窗、平台层四动作与消息表"
```

---

## Task 5: 皮肤包契约与校验

**Files:**
- Create: `src/shared/skin.ts`, `src/main/skin-store.ts`, `test/skin.test.ts`
- Modify: `skins/block/manifest.json`

**Interfaces:**
- Consumes: `REQUIRED_POOLS`、`CANVAS_W/CANVAS_H`、`analyzeAlpha`
- Produces:
  - `type SkinManifest`（字段见 Step 1）
  - `type LoadedSkin = { dir: string; manifest: SkinManifest; clips: Record<string, string[]> }`（`clips[pool]` 是该池可用的动画**名字**列表 → 相对路径由 `clipPath(skin, pool, name)` 给出）
  - `validateManifest(raw: unknown): { ok: true; manifest: SkinManifest } | { ok: false; errors: string[] }`
  - `clipPath(skin: LoadedSkin, pool: string, name: string): string`
  - `missingRequiredPools(manifest: SkinManifest): string[]`

- [ ] **Step 1: 写 manifest 类型与校验（失败测试先行）**

```ts
// test/skin.test.ts
import { describe, it, expect } from 'vitest'
import { validateManifest, missingRequiredPools } from '../src/shared/skin'

const good = {
  formatVersion: 1,
  name: '色块',
  canvas: { w: 640, h: 360, feetY: 330 },
  bodyBox: { x: 200, y: 50, w: 240, h: 285 },
  pools: { idle: ['patrol', 'patrol2'], turn: ['left'], move: ['step'], click: ['tapped'], drag: ['pulled'] },
}

describe('validateManifest', () => {
  it('合法 manifest 通过', () => {
    expect(validateManifest(good).ok).toBe(true)
  })
  it('formatVersion 不认识就报错而不是猜', () => {
    const r = validateManifest({ ...good, formatVersion: 99 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('formatVersion')
  })
  it('缺 bodyBox 报错', () => {
    const { bodyBox, ...rest } = good
    const r = validateManifest(rest)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('bodyBox')
  })
  it('必需池缺失由 missingRequiredPools 列出（拒绝装载用）', () => {
    const r = validateManifest({ ...good, pools: { idle: ['patrol'] } })
    expect(r.ok).toBe(true)          // 结构合法
    expect(missingRequiredPools(r.ok ? r.manifest : good)).toEqual(['turn', 'move', 'click', 'drag'])
  })
  it('动画名不许带路径分隔符', () => {
    const r = validateManifest({ ...good, pools: { ...good.pools, idle: ['../../etc/passwd'] } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('idle')
  })
})
```

Run: `npm run test -- skin` → Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现校验**

```ts
// src/shared/skin.ts
import { REQUIRED_POOLS, CANVAS_W, CANVAS_H } from './config'
import type { Box } from './types'

export type PoolName = (typeof REQUIRED_POOLS)[number] | string
export type AnimationMeta = { loop: boolean; mirrorable: boolean; bodyBox?: Box }
export type SkinManifest = {
  formatVersion: number
  name: string
  canvas: { w: number; h: number; feetY: number }
  bodyBox: Box
  pools: Record<string, string[]>
  /** 可选：每条动画覆盖循环性与镜像性；缺省 = 池 idle/turn/move 循环，其余一次性 */
  animationMeta?: Record<string, AnimationMeta>
  /** 可选：热点（v2 用），v1 只透传不解释 */
  hotspots?: Record<string, Box>
}

const SUPPORTED_FORMAT = 1

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const isBox = (v: unknown): v is Box => {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return isInt(b.x, 0, 4096) && isInt(b.y, 0, 4096) && isInt(b.w, 1, 4096) && isInt(b.h, 1, 4096)
}
/** 动画名会拼进文件路径，必须挡掉分隔符与保留字符 */
const isSafeName = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= 64 && /^[^./\\:*?"<>|]+$/.test(s)

export function validateManifest(raw: unknown): { ok: true; manifest: SkinManifest } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['manifest 不是对象'] }
  const m = raw as Record<string, unknown>

  if (m.formatVersion !== SUPPORTED_FORMAT) errors.push(`formatVersion 必须是 ${SUPPORTED_FORMAT}，当前 ${String(m.formatVersion)}`)
  if (typeof m.name !== 'string' || !m.name) errors.push('name 必填')
  const c = m.canvas as Record<string, unknown> | undefined
  if (!c || c.w !== CANVAS_W || c.h !== CANVAS_H) errors.push(`canvas 必须是 ${CANVAS_W}x${CANVAS_H}`)
  if (!c || !isInt(c.feetY, 0, CANVAS_H)) errors.push('canvas.feetY 非法')
  if (!isBox(m.bodyBox)) errors.push('bodyBox 非法或缺失')

  const pools = m.pools as Record<string, unknown> | undefined
  if (!pools || typeof pools !== 'object') errors.push('pools 缺失')
  else {
    for (const [pool, list] of Object.entries(pools)) {
      if (!Array.isArray(list)) { errors.push(`pools.${pool} 不是数组`); continue }
      if (list.length === 0) errors.push(`pools.${pool} 是空池`)
      for (const n of list) if (!isSafeName(n)) errors.push(`pools.${pool} 含非法动画名 ${String(n)}`)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as unknown as SkinManifest }
}

/** 拒绝装载用：返回缺失的必需池名。 */
export function missingRequiredPools(manifest: SkinManifest): string[] {
  return REQUIRED_POOLS.filter((p) => !manifest.pools[p] || manifest.pools[p].length === 0)
}

/** 默认一次性还是循环：只有一个候选时循环，多个变体则一次性（避免看着卡住）。 */
export function isLooping(manifest: SkinManifest, pool: string): boolean {
  const explicit = manifest.animationMeta?.[pool]?.loop
  if (explicit !== undefined) return explicit
  return (manifest.pools[pool]?.length ?? 0) <= 1
}

export function isMirrorable(manifest: SkinManifest, name: string): boolean {
  const explicit = manifest.animationMeta?.[name]?.mirrorable
  return explicit ?? true
}
```

- [ ] **Step 3: 跑测试确认全通过**

Run: `npm run test -- skin` → Expected: 5 passed

- [ ] **Step 4: 装载器：读目录、校验结构、再校验素材文件存在**

```ts
// src/main/skin-store.ts
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SKIN_MANIFEST } from '../shared/config'
import { validateManifest, missingRequiredPools, type SkinManifest } from '../shared/skin'

export type LoadedSkin = {
  dir: string
  manifest: SkinManifest
  /** pool → 实际存在素材的动画名（缺失的会被剔掉，不报错） */
  pools: Record<string, string[]>
}

export type LoadResult = { ok: true; skin: LoadedSkin } | { ok: false; errors: string[] }

export function loadSkin(rawDir: string): LoadResult {
  // 目录一律转成绝对路径：渲染层要靠它拼 file:// 地址，相对路径过 IPC 会失效
  const dir = resolve(rawDir)
  const manifestPath = join(dir, SKIN_MANIFEST)
  if (!existsSync(manifestPath)) return { ok: false, errors: [`找不到 ${manifestPath}`] }
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const v = validateManifest(raw)
  if (!v.ok) return { ok: false, errors: v.errors }

  const missing = missingRequiredPools(v.manifest)
  if (missing.length) return { ok: false, errors: [`必需动画池缺失：${missing.join('、')}`] }

  const pools: Record<string, string[]> = {}
  for (const [pool, names] of Object.entries(v.manifest.pools)) {
    pools[pool] = names.filter((n) => existsSync(clipFile(dir, pool, n)))
  }
  return { ok: true, skin: { dir, manifest: v.manifest, pools } }
}

export function clipFile(dir: string, pool: string, name: string): string {
  return join(dir, 'animation', pool, `${name}.webm`)
}
```

- [ ] **Step 5: 装载内置皮肤，确认无错误**

```ts
// test/skin-store.test.ts
import { describe, it, expect } from 'vitest'
import { loadSkin } from '../src/main/skin-store'

describe('内置色块皮肤', () => {
  it('结构合法且必需池齐全', () => {
    const r = loadSkin('skins/block')
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(Object.keys(r.skin.pools.idle).length).toBeGreaterThan(0)
    expect(r.skin.pools.drag).toContain('pulled')
  })
})
```

Run: `npm run test -- skin-store` → Expected: PASS（依赖 Task 2 已生成 6 个 webm；若失败，先跑 `node tools/make-test-skin.mjs`）

- [ ] **Step 6: 提交**

```bash
git add src/shared/skin.ts src/main/skin-store.ts test/skin.test.ts test/skin-store.test.ts skins/block/manifest.json
git commit -m "feat: 皮肤 manifest 契约、动画名安全校验与装载"
```

---

## Task 6: 几何换算（画布坐标 → 屏幕矩形）

皮肤的 `bodyBox` 是 640×360 画布坐标，屏幕上宠物是 `STAGE_W_CSS` 宽。这层换算和「身体 ∪ 面板」的集合判定是纯函数，是后续所有点击行为的底座。

**Files:**
- Create: `src/shared/geometry.ts`, `test/geometry.test.ts`

**Interfaces:**
- Consumes: `Rect/Box/Point`、`CANVAS_W/CANVAS_H`、`STAGE_W_CSS/STAGE_H_CSS`
- Produces:
  - `stageRect(petPos: Point): Rect`
  - `bodyRect(manifest: {bodyBox: Box}, petPos: Point, override?: Box): Rect`
  - `unionOf(rects: Rect[]): Rect[]`（原样返回，判定用 `anyContains`，不做几何合并 — 避免过早复杂化）
  - `anyContains(rects: Rect[], p: Point): boolean`

- [ ] **Step 1: 写失败测试**

```ts
// test/geometry.test.ts
import { describe, it, expect } from 'vitest'
import { stageRect, bodyRect, anyContains } from '../src/shared/geometry'

const box = { x: 200, y: 50, w: 240, h: 285 }
const pos = { x: 400, y: 300 }   // 舞台左上角（覆盖层坐标）

describe('bodyRect', () => {
  it('舞台矩形是 16:9 且由 STAGE_W_CSS 推导', () => {
    const s = stageRect(pos)
    expect(s).toEqual({ x: 400, y: 300, w: 320, h: 180 })
  })
  it('画布身体框按缩放换算到屏幕', () => {
    const r = bodyRect({ bodyBox: box }, pos)
    expect(r.x).toBeCloseTo(400 + 200 * (320 / 640), 6)      // 500
    expect(r.y).toBeCloseTo(300 + 50 * (180 / 360), 6)       // 325
    expect(r.w).toBeCloseTo(240 * (320 / 640), 6)            // 120
    expect(r.h).toBeCloseTo(285 * (180 / 360), 6)            // 142.5
  })
  it('单条动画可覆盖身体框（趴下时压扁）', () => {
    const r = bodyRect({ bodyBox: box }, pos, { x: 100, y: 200, w: 400, h: 100 })
    expect(r.w).toBeCloseTo(200, 6)
    expect(r.h).toBeCloseTo(50, 6)
  })
})

describe('anyContains', () => {
  it('身体 ∪ 面板 任一命中即为真', () => {
    const rects = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 50, h: 20 }]
    expect(anyContains(rects, { x: 5, y: 5 })).toBe(true)
    expect(anyContains(rects, { x: 120, y: 110 })).toBe(true)
    expect(anyContains(rects, { x: 50, y: 50 })).toBe(false)
    expect(anyContains([], { x: 1, y: 1 })).toBe(false)
  })
})
```

Run: `npm run test -- geometry` → Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现**

```ts
// src/shared/geometry.ts
import { CANVAS_W, CANVAS_H, STAGE_W_CSS, STAGE_H_CSS } from './config'
import type { Box, Point, Rect } from './types'

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/** 宠物舞台（视频画框）在覆盖层中的矩形。 */
export function stageRect(petPos: Point): Rect {
  return { x: petPos.x, y: petPos.y, w: STAGE_W_CSS, h: STAGE_H_CSS }
}

/**
 * 身体矩形：画布坐标 → 覆盖层坐标。
 * @param manifest 只提供 bodyBox
 * @param petPos 舞台左上角
 * @param override 当前动画自己的覆盖框（趴下、躲藏等轮廓剧变的动作）
 */
export function bodyRect(manifest: { bodyBox: Box }, petPos: Point, override?: Box): Rect {
  const box = override ?? manifest.bodyBox
  const sx = STAGE_W_CSS / CANVAS_W
  const sy = STAGE_H_CSS / CANVAS_H
  return {
    x: petPos.x + box.x * sx,
    y: petPos.y + box.y * sy,
    w: box.w * sx,
    h: box.h * sy,
  }
}

export function anyContains(rects: Rect[], p: Point): boolean {
  return rects.some((r) => rectContains(r, p))
}
```

> `rectContains` 在 `types.ts` 与 `geometry.ts` 中重复了。Step 3 消掉它。

- [ ] **Step 3: 消除重复：types.ts 不导出 rectContains，只留类型**

把 `src/shared/types.ts` 里的 `rectContains` 函数删除（类型保留），确认 `grep -rn "rectContains" src/` 只在 `geometry.ts` 有一处定义。

Run: `npm run typecheck && npm run test -- geometry` → Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/shared/geometry.ts src/shared/types.ts test/geometry.test.ts
git commit -m "feat: 画布到覆盖层的身体矩形换算与多区命中"
```

---

## Task 7: ClipPlayer 接口与双 video 后端

设计文档第 7 节：接口先定，实现只有 video 一个，但四铁律必须有测试锁住。测试用假实现验证接口约定，用 Playwright 验证真实 DOM 交换。

**Files:**
- Create: `src/renderer/player/clip-player.ts`, `src/renderer/player/video-backend.ts`, `src/renderer/player/fake-backend.ts`, `test/clip-player.test.ts`, `e2e/video-backend.spec.ts`

**Interfaces:**
- Consumes: `LoadedSkin`、`clipFile`、`isLooping`
- Produces:
  ```ts
  type ClipRef = { pool: string; name: string }
  interface ClipPlayer {
    prepare(ref: ClipRef): void
    play(ref: ClipRef, opts?: { once?: boolean }): Promise<'ended' | 'cancelled'>
    cancel(): void
    readonly current: ClipRef | null
    readonly generation: number
    frameIndex(): number
    snapshot(): string | null
    hitTest(p: Point): boolean
    destroy(): void
  }
  ```

- [ ] **Step 1: 定义接口与假实现**

```ts
// src/renderer/player/clip-player.ts
export type ClipRef = { pool: string; name: string }
export type PlayResult = 'ended' | 'cancelled'

export interface ClipPlayer {
  /** 提前把素材加载到能立刻显示；重复调用同一 ref 无副作用 */
  prepare(ref: ClipRef): void
  /** once=true 播完 resolve('ended')；被 cancel 则 resolve('cancelled') */
  play(ref: ClipRef, opts?: { once?: boolean }): Promise<PlayResult>
  cancel(): void
  readonly current: ClipRef | null
  /** 每次 play 递增。异步回调必须校验它，丢弃过期结果 */
  readonly generation: number
  frameIndex(): number
  snapshot(): string | null
  /** 视频后端给矩形近似；将来帧序列后端给逐像素 */
  hitTest(p: { x: number; y: number }): boolean
  destroy(): void
}

export function sameClip(a: ClipRef | null, b: ClipRef): boolean {
  return !!a && a.pool === b.pool && a.name === b.name
}
```

```ts
// src/renderer/player/fake-backend.ts
import type { ClipPlayer, ClipRef, PlayResult } from './clip-player'

/** 测试用：play 立刻可控地结束，不等真视频。advance() 手动推进时间。 */
export function createFakePlayer(): ClipPlayer & {
  advance(): void
  readonly calls: ClipRef[]
  readonly prepared: ClipRef[]
} {
  let current: ClipRef | null = null
  let generation = 0
  let pending: ((r: PlayResult) => void) | null = null
  const calls: ClipRef[] = []
  const prepared: ClipRef[] = []
  return {
    calls, prepared,
    get current() { return current },
    get generation() { return generation },
    prepare(ref) { prepared.push(ref) },
    play(ref, opts) {
      generation++
      current = ref
      calls.push(ref)
      return new Promise<PlayResult>((resolve) => {
        // 覆盖上一次未结束的播放：等价于真后端的「新 play 作废旧 pending」
        pending?.('cancelled')
        pending = resolve
        if (opts?.once === false) { /* 循环语义：不自动结束，由 cancel 收尾 */ }
      })
    },
    advance() { const r = pending; pending = null; current = null; r?.('ended') },
    cancel() { const r = pending; pending = null; r?.('cancelled') },
    frameIndex() { return 0 },
    snapshot() { return null },
    hitTest() { return false },
    destroy() { this.cancel() },
  }
}
```

- [ ] **Step 2: 写接口约定的失败测试（用假实现锁语义）**

```ts
// test/clip-player.test.ts
import { describe, it, expect } from 'vitest'
import { createFakePlayer } from '../src/renderer/player/fake-backend'
import { sameClip } from '../src/renderer/player/clip-player'

describe('ClipPlayer 语义约定', () => {
  it('每次 play 递增 generation', async () => {
    const p = createFakePlayer()
    expect(p.generation).toBe(0)
    p.play({ pool: 'idle', name: 'a' }, { once: true })
    expect(p.generation).toBe(1)
    p.play({ pool: 'idle', name: 'b' }, { once: true })
    expect(p.generation).toBe(2)
  })
  it('once 播放 advance 后 resolve ended', async () => {
    const p = createFakePlayer()
    const r = p.play({ pool: 'click', name: 'tapped' }, { once: true })
    p.advance()
    await expect(r).resolves.toBe('ended')
  })
  it('cancel 使进行中的 play resolve cancelled', async () => {
    const p = createFakePlayer()
    const r = p.play({ pool: 'idle', name: 'a' }, { once: true })
    p.cancel()
    await expect(r).resolves.toBe('cancelled')
  })
  it('sameClip 区分同池同名', () => {
    expect(sameClip({ pool: 'idle', name: 'a' }, { pool: 'idle', name: 'a' })).toBe(true)
    expect(sameClip({ pool: 'idle', name: 'a' }, { pool: 'idle', name: 'b' })).toBe(false)
    expect(sameClip(null, { pool: 'idle', name: 'a' })).toBe(false)
  })
})
```

Run: `npm run test -- clip-player` → Expected: PASS（这组测试是后端的验收标准，Task 7 后半用真 DOM 复现同一组断言）

- [ ] **Step 3: 实现双 video 后端，逐条落地四铁律**

```ts
// src/renderer/player/video-backend.ts
import type { ClipPlayer, ClipRef, PlayResult } from './clip-player'
import type { LoadedSkin } from '../../shared/skin-store'   // 见 Step 4：抽到 shared 以免 renderer 依赖 main
import { CANVAS_W, CANVAS_H, STAGE_W_CSS, STAGE_H_CSS } from '../../shared/config'

/**
 * 两个 <video> 轮流当前台。四铁律：
 * ① 新素材 loadeddata 之后才切换，不在赋值 src 时切换
 * ② 每次 play 递增代际号，过期回调丢弃
 * ③ 退到后台的 video 必须摘掉 onended
 * ④ 用 opacity 过渡垫接缝
 */
export function createVideoPlayer(
  stage: HTMLElement,
  urlFor: (ref: ClipRef) => string,
): ClipPlayer {
  const mk = (front: boolean) => {
    const v = document.createElement('video')
    v.className = 'pet-video' + (front ? ' is-front' : '')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    stage.appendChild(v)
    return v
  }
  let front = mk(true)
  let back = mk(false)
  let generation = 0
  let current: ClipRef | null = null
  let pending: ((r: PlayResult) => void) | null = null

  function swapTo(nextFront: HTMLVideoElement, nextBack: HTMLVideoElement) {
    nextFront.classList.add('is-front')
    // 铁律③：退位的先把 ended 摘掉，否则它在后台播完会杀掉当前动画
    nextBack.classList.remove('is-front')
    nextBack.onended = null
    nextBack.pause()
  }

  return {
    get current() { return current },
    get generation() { return generation },

    prepare(ref) {
      const v = back
      if (v.dataset.ref === key(ref)) return
      v.src = urlFor(ref)
      v.dataset.ref = key(ref)
      v.load()
    },

    play(ref, opts) {
      const once = opts?.once ?? false
      generation++
      const myGen = generation                 // 铁律②
      current = ref
      const nextFront = back, nextBack = front
      if (nextFront.dataset.ref !== key(ref)) {
        nextFront.src = urlFor(ref)
        nextFront.dataset.ref = key(ref)
        nextFront.load()
      }
      nextFront.loop = !once
      pending?.('cancelled')                   // 上一次未结束的调用作废
      pending = null

      return new Promise<PlayResult>((resolve) => {
        const finish = (r: PlayResult) => {
          if (myGen !== generation) return     // 过期回调丢弃
          if (pending !== resolve) return
          pending = null
          resolve(r)
        }
        const onReady = () => {
          if (myGen !== generation) { nextFront.removeEventListener('loadeddata', onReady); return }
          nextFront.removeEventListener('loadeddata', onReady)
          swapTo(nextFront, nextBack)          // 铁律①
          front = nextFront                    // 关键：槽位互换，否则下一次播放用的是退位的那个
          back = nextBack
          nextFront.onended = once ? () => finish('ended') : null
          void nextFront.play().catch(() => finish('cancelled'))
          pending = resolve
        }
        if (nextFront.readyState >= 2) onReady()
        else nextFront.addEventListener('loadeddata', onReady, { once: true })
        pending = resolve
        // 取消路径由 cancel() 驱动
      })
    },

    cancel() {
      generation++
      const r = pending
      pending = null
      if (r) r('cancelled')
    },

    frameIndex() {
      const fps = 24
      return Math.floor((front.currentTime || 0) * fps)
    },
    snapshot() {
      try {
        const c = document.createElement('canvas')
        c.width = CANVAS_W; c.height = CANVAS_H
        c.getContext('2d')?.drawImage(front, 0, 0, CANVAS_W, CANVAS_H)
        return c.toDataURL('image/png')
      } catch { return null }
    },
    /** 视频后端只能给画框级近似：身体矩形由调用方按皮肤换算，这里回答舞台范围 */
    hitTest(p) {
      return p.x >= 0 && p.x <= STAGE_W_CSS && p.y >= 0 && p.y <= STAGE_H_CSS
    },
    destroy() {
      front.remove(); back.remove()
      front = back = null as unknown as HTMLVideoElement
    },
  }
}

function key(ref: ClipRef): string { return `${ref.pool}/${ref.name}` }
```

- [ ] **Step 4: 把 LoadedSkin 挪到 shared，避免渲染层 import 主进程模块**

`src/main/skin-store.ts` 里的 `LoadedSkin`/`clipFile` 移到 `src/shared/skin-store-types.ts`（纯类型 + 纯路径拼接），`skin-store.ts` 改为 import 它。运行：

```bash
grep -rn "skin-store" src/renderer/ || echo "renderer 不依赖 main ✔"
```

Expected: 打印 `renderer 不依赖 main ✔`

- [ ] **Step 5: 用 Playwright 驱动 Electron，验真实 DOM 交换**

```ts
// e2e/video-backend.spec.ts
import { test, expect, _electron as electron } from 'playwright'

test('两个 video 元素交替，前台唯一 is-front', async () => {
  const app = await electron.launch({ args: ['dist/main/index.js'] })
  const win = await app.firstWindow()
  await win.evaluate(() => {
    // 由测试页暴露的调试钩子驱动播放器
    return (window as unknown as { __testPlay: (p: string, n: string, once: boolean) => Promise<string> })
      .__testPlay('idle', 'patrol', false)
  })
  const count = await win.locator('video.pet-video').count()
  expect(count).toBe(2)
  expect(await win.locator('video.pet-video.is-front').count()).toBe(1)

  await win.evaluate(() => (window as never as { __testPlay: (a: string, b: string, c: boolean) => Promise<string> }).__testPlay('click', 'tapped', true))
  expect(await win.locator('video.pet-video.is-front').count()).toBe(1)
  await app.close()
})
```

> 该测试要求 Task 10 提供 `window.__testPlay` 调试钩子。本步骤先建 `e2e/` 目录与配置，把此文件标记为 `test.skip`，Task 10 取消 skip。

```ts
// vitest 不跑 e2e；e2e 用 playwright runner
// package.json 增加：
//   "e2e": "playwright test e2e"
```

- [ ] **Step 6: 提交**

```bash
git add src/renderer/player/ src/shared/skin-store-types.ts src/main/skin-store.ts e2e/ package.json
git commit -m "feat: ClipPlayer 接口与双 video 后端（代际号守卫、loadeddata 门控、ended 摘除）"
```

---

## Task 8: 悬停计时与穿透租约的完整语义

Task 4 建了最小租约，本任务补齐「停留 400ms 弹面板 / 离开 400ms 收 / 超时兜底」并全部单测。

**Files:**
- Create: `src/shared/hover.ts`, `test/hover.test.ts`, `test/lease.test.ts`
- Modify: `src/shared/lease.ts`

**Interfaces:**
- Consumes: `HOVER_DWELL_MS`、`HOVER_RELEASE_MS`、`LEASE_TIMEOUT_MS`
- Produces:
  - `createHoverTimer(now: () => number)` → `{ onPoint(p: Point, overBody: boolean, overPanel: boolean): HoverEvent }`，`HoverEvent = 'open' | 'close' | 'none'`
  - `Lease.renew(want: boolean): boolean`（改名保留 tick 兼容）

- [ ] **Step 1: 写悬停的失败测试**

```ts
// test/hover.test.ts
import { describe, it, expect } from 'vitest'
import { createHoverTimer } from '../src/shared/hover'

describe('悬停计时', () => {
  it('进入身体后立刻弹出不算，需停留满 400ms', () => {
    let t = 0
    const h = createHoverTimer(() => t)
    const p = { x: 1, y: 1 }
    expect(h.onPoint(p, true, false)).toBe('none')     // t=0 进入
    t = 399
    expect(h.onPoint(p, true, false)).toBe('none')     // 未满
    t = 401
    expect(h.onPoint(p, true, false)).toBe('open')     // 满 400ms 才开
  })
  it('已经开着时重复进入不再重复触发 open', () => {
    let t = 0
    const h = createHoverTimer(() => t)
    h.onPoint({ x: 1, y: 1 }, true, false)
    t = 500; expect(h.onPoint({ x: 1, y: 1 }, true, false)).toBe('open')
    t = 600; expect(h.onPoint({ x: 1, y: 1 }, true, false)).toBe('none')
  })
  it('光标移到面板上时保持打开，不算离开', () => {
    let t = 500
    const h = createHoverTimer(() => t)
    h.onPoint({ x: 1, y: 1 }, true, false)
    t = 900; expect(h.onPoint({ x: 1, y: 1 }, true, false)).toBe('open')
    t = 1000; expect(h.onPoint({ x: 1, y: 1 }, false, true)).toBe('none')   // 在面板上：不关
  })
  it('离开身体与面板满 400ms 才 close', () => {
    let t = 500
    const h = createHoverTimer(() => t)
    h.onPoint({ x: 1, y: 1 }, true, false)
    t = 900; h.onPoint({ x: 1, y: 1 }, true, false)
    t = 901; expect(h.onPoint({ x: 9, y: 9 }, false, false)).toBe('none')   // 刚开始离开
    t = 1300; expect(h.onPoint({ x: 9, y: 9 }, false, false)).toBe('none')  // 未满
    t = 1302; expect(h.onPoint({ x: 9, y: 9 }, false, false)).toBe('close')
  })
  it('离开途中又回到身体，离开计时清零，不产生 close', () => {
    let t = 900
    const h = createHoverTimer(() => t)
    h.onPoint({ x: 1, y: 1 }, true, false)
    t = 950; h.onPoint({ x: 1, y: 1 }, true, false)
    t = 1000; h.onPoint({ x: 9, y: 9 }, false, false)   // 离开 1000
    t = 1100; expect(h.onPoint({ x: 1, y: 1 }, true, false)).toBe('none')  // 回来了
    t = 1500; expect(h.onPoint({ x: 1, y: 1 }, true, false)).toBe('none')
  })
})
```

Run: `npm run test -- hover` → Expected: FAIL

- [ ] **Step 2: 实现悬停计时**

```ts
// src/shared/hover.ts
import { HOVER_DWELL_MS, HOVER_RELEASE_MS } from './config'
import type { Point } from './types'

export type HoverEvent = 'open' | 'close' | 'none'

/**
 * 停留满 HOVER_DWELL_MS 才 open；离开身体与面板满 HOVER_RELEASE_MS 才 close。
 * 只在光标移动时由渲染层调用（主进程 33ms 推进来一次）。
 */
export function createHoverTimer(now: () => number) {
  let enteredAt: number | null = null
  let leftAt: number | null = null
  let open = false

  return {
    get isOpen() { return open },
    onPoint(_p: Point, overBody: boolean, overPanel: boolean): HoverEvent {
      const inside = overBody || overPanel
      if (inside) {
        leftAt = null
        if (!open) {
          enteredAt ??= now()
          if (now() - enteredAt >= HOVER_DWELL_MS) {
            open = true
            enteredAt = null
            return 'open'
          }
        }
        return 'none'
      }
      enteredAt = null
      if (open) {
        leftAt ??= now()
        if (now() - leftAt >= HOVER_RELEASE_MS) {
          open = false
          leftAt = null
          return 'close'
        }
      }
      return 'none'
    },
    /** 皮肤切换、宠物被拖走等情况要重置，否则面板挂在旧位置 */
    reset() { enteredAt = null; leftAt = null; open = false },
  }
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `npm run test -- hover` → Expected: 5 passed

- [ ] **Step 4: 补齐租约测试（超时兜底路径）**

```ts
// test/lease.test.ts
import { describe, it, expect } from 'vitest'
import { createLease } from '../src/shared/lease'

describe('穿透租约', () => {
  it('want=true 时进入接住状态', () => {
    let t = 0
    const l = createLease({ timeoutMs: 500, now: () => t })
    expect(l.tick(true)).toBe(true)
    expect(l.interactive).toBe(true)
    expect(l.tick(true)).toBe(false)       // 续期不改变状态
  })
  it('want=false 立刻放开', () => {
    let t = 0
    const l = createLease({ timeoutMs: 500, now: () => t })
    l.tick(true)
    expect(l.tick(false)).toBe(true)
    expect(l.interactive).toBe(false)
  })
  it('渲染层卡死不再续期，超过 timeout 由 sweep 强制放开', () => {
    let t = 0
    const l = createLease({ timeoutMs: 500, now: () => t })
    l.tick(true)
    t = 400; expect(l.sweep()).toBe(false)      // 还在租期内
    t = 501; expect(l.sweep()).toBe(true)       // 超时，状态改变
    expect(l.interactive).toBe(false)
  })
  it('超时后再来请求可以重新接住', () => {
    let t = 0
    const l = createLease({ timeoutMs: 500, now: () => t })
    l.tick(true); t = 600; l.sweep()
    expect(l.tick(true)).toBe(true)
    expect(l.interactive).toBe(true)
  })
})
```

Run: `npm run test -- lease` → Expected: 4 passed（Task 4 的实现已满足；此处是把行为钉死）

- [ ] **Step 5: 提交**

```bash
git add src/shared/hover.ts src/shared/lease.ts test/hover.test.ts test/lease.test.ts
git commit -m "feat: 悬停 400ms 停留与释放计时、穿透租约超时兜底"
```

---

## Task 9: 行为调度 — 规则层 + 随机层

**Files:**
- Create: `src/shared/behavior.ts`, `src/shared/rules.ts`, `test/behavior.test.ts`, `test/rules.test.ts`

**Interfaces:**
- Consumes: `LoadedSkin.pools`
- Produces:
  - `createPicker(rng: () => number)` → `pick(skin, current: {pool,name} | null): ClipRef`
  - `createRuleEngine(now: () => number)` → `feed(ev: RuleEvent): PoolName`，`RuleEvent = 'tick' | 'interacted' | 'dragged' | 'idle-long'`

- [ ] **Step 1: 写随机层失败测试（固定种子，可重复）**

```ts
// test/behavior.test.ts
import { describe, it, expect } from 'vitest'
import { createPicker } from '../src/shared/behavior'

const skin = { pools: { idle: ['a', 'b', 'c'], turn: ['left'], move: ['step'] } }

describe('createPicker', () => {
  it('空池返回 null 而不是崩溃', () => {
    const p = createPicker(() => 0)
    expect(p.pickFrom({ pools: { idle: [] } }, 'idle', null)).toBeNull()
  })
  it('同种子同序列', () => {
    const seedRng = () => { let s = 42; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 } }
    const a = createPicker(seedRng()), b = createPicker(seedRng())
    expect(a.pickFrom(skin, 'idle', null)?.name).toBe(b.pickFrom(skin, 'idle', null)?.name)
  })
  it('排除当前这条，避免连着播同一个动作看着卡住', () => {
    const p = createPicker(() => 0)
    const cur = { pool: 'idle', name: 'a' }
    const next = p.pickFrom(skin, 'idle', cur)
    expect(next?.name).not.toBe('a')
  })
  it('池只剩一条时只能重复它', () => {
    const p = createPicker(() => 0)
    expect(p.pickFrom({ pools: { idle: ['solo'] } }, 'idle', { pool: 'idle', name: 'solo' })?.name).toBe('solo')
  })
  it('按权重抽取：权重高的池被选中比例更高', () => {
    const rng = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 } })()
    const p = createPicker(rng)
    const weighted = { pools: { idle: ['a'], move: ['m'] } }
    const counts = { idle: 0, move: 0 }
    for (let i = 0; i < 2000; i++) {
      const r = p.pickWeightedPool(weighted, ['idle', 'move'], [1, 3], null)
      counts[r!.pool]++
    }
    expect(counts.move).toBeGreaterThan(counts.idle * 2)
  })
})
```

Run: `npm run test -- behavior` → Expected: FAIL

- [ ] **Step 2: 实现随机层**

```ts
// src/shared/behavior.ts
import type { ClipRef } from '../renderer/player/clip-player'

export type PoolSource = { pools: Record<string, string[]> }

/** rng 注入以便测试可重复（等价于 Java 传 Random 种子）。 */
export function createPicker(rng: () => number) {
  function pickFrom(skin: PoolSource, pool: string, current: ClipRef | null): ClipRef | null {
    const names = skin.pools[pool] ?? []
    if (names.length === 0) return null
    let candidates = names
    if (names.length > 1 && current && current.pool === pool) {
      candidates = names.filter((n) => n !== current.name)
    }
    const i = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))
    return { pool, name: candidates[i] }
  }

  /** 权重与池名一一对应，全部来自皮肤，代码里不写数字。 */
  function pickWeightedPool(skin: PoolSource, pools: string[], weights: number[], current: ClipRef | null): ClipRef | null {
    const total = pools.reduce((s, p, i) => s + (skin.pools[p]?.length ? weights[i] : 0), 0)
    if (total <= 0) return null
    let roll = rng() * total
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i]
      if (!skin.pools[p]?.length) continue
      roll -= weights[i]
      if (roll < 0) return pickFrom(skin, p, current)
    }
    return pickFrom(skin, pools[0], current)
  }

  return { pickFrom, pickWeightedPool }
}
```

- [ ] **Step 3: 实现规则层（确定性，注入时钟）**

```ts
// src/shared/rules.ts
/** 规则层只决定「现在该进哪个池」，不决定具体哪条动画。 */
export type RuleEvent = 'tick' | 'interacted' | 'dragged' | 'idle-long'
export type RuleState = 'active' | 'respond' | 'drag'

export function createRuleEngine(now: () => number, idleLongMs: number) {
  let lastInteraction = now()
  let state: RuleState = 'active'
  return {
    get state() { return state as RuleState },
    feed(ev: RuleEvent): string {
      switch (ev) {
        case 'interacted': lastInteraction = now(); state = 'respond'; return 'click'
        case 'dragged': lastInteraction = now(); state = 'drag'; return 'drag'
        case 'idle-long': state = 'active'; return 'idle'
        case 'tick':
          if (state === 'respond' || state === 'drag') { state = 'active'; return 'idle' }
          if (now() - lastInteraction > idleLongMs) return 'move'   // 长时间没人理，自己走走
          return 'idle'
      }
    },
  }
}
```

- [ ] **Step 4: 写规则层测试**

```ts
// test/rules.test.ts
import { describe, it, expect } from 'vitest'
import { createRuleEngine } from '../src/shared/rules'

describe('规则层', () => {
  it('刚被点过 → 下一 tick 回 idle', () => {
    let t = 0
    const r = createRuleEngine(() => t, 60000)
    expect(r.feed('interacted')).toBe('click')
    expect(r.feed('tick')).toBe('idle')
  })
  it('超过 idleLongMs 无人交互 → tick 落到 move', () => {
    let t = 0
    const r = createRuleEngine(() => t, 1000)
    expect(r.feed('tick')).toBe('idle')
    t = 1500
    expect(r.feed('tick')).toBe('move')
  })
  it('拖拽结束后不立刻自主移动', () => {
    let t = 0
    const r = createRuleEngine(() => t, 1000)
    r.feed('dragged')
    t = 1500
    expect(r.feed('tick')).toBe('idle')   // respond/drag 归位优先于 move
  })
})
```

Run: `npm run test -- rules` → Expected: 3 passed

- [ ] **Step 5: 提交**

```bash
git add src/shared/behavior.ts src/shared/rules.ts test/behavior.test.ts test/rules.test.ts
git commit -m "feat: 可注入随机源的行为抽取与规则层状态转换"
```

---

## Task 10: 渲染层装配 — 位置、行为链、拖拽、续期

把前面所有件接起来，让宠物真的显示、真的动、真的能被拖。

**Files:**
- Create: `src/renderer/index.ts`, `src/renderer/sprite.ts`, `src/renderer/style.css`, `src/renderer/bridge.ts`, `test/motion.test.ts`, `src/shared/motion.ts`
- Modify: `src/renderer/index.html`, `src/main/platform.ts`（补 `setPositionHint` 不需要——覆盖层不动窗）

**Interfaces:**
- Consumes: `ClipPlayer`、`createPicker`、`createRuleEngine`、`createHoverTimer`、`bodyRect`、`IPC.cursor`
- Produces:
  - `createMotion(bounds: Rect, speedPxPerSec: number)` → `{ step(dtMs: number): Point; facing(): 'left'|'right'; pos(): Point }`
  - `window.petBridge` 类型声明
  - 调试钩子 `window.__testPlay(pool, name, once)`

- [ ] **Step 1: 位移模型（纯逻辑，先测）**

桌宠沿桌面的底边散步，脚底贴工作区底部。位移由每帧 `step(dt)` 积分，不靠计时器对齐动画 —— 用 `frameIndex()` 校正。

```ts
// test/motion.test.ts
import { describe, it, expect } from 'vitest'
import { createMotion } from '../src/shared/motion'

const bounds = { x: 0, y: 0, w: 1000, h: 600 }

describe('createMotion', () => {
  it('向右走碰到右边界就停下并转向', () => {
    const m = createMotion(bounds, 100, { x: 900, y: 500 }, 'right')
    m.step(500)                    // +50px → 950，未越界
    expect(m.pos().x).toBeCloseTo(950, 3)
    m.step(500)                    // 再 +50 会越过 1000-320 的右限
    expect(m.facing()).toBe('left')
    expect(m.pos().x).toBeLessThanOrEqual(1000 - 320)
  })
  it('dt 为 0 不产生位移', () => {
    const m = createMotion(bounds, 100, { x: 100, y: 100 }, 'right')
    m.step(0)
    expect(m.pos().x).toBe(100)
  })
  it('宠物贴工作区底边：y 固定在底 - 舞台高', () => {
    const m = createMotion(bounds, 0, { x: 10, y: 0 }, 'right')
    m.snapToBottom()
    expect(m.pos().y).toBe(600 - 180)
  })
})
```

Run: `npm run test -- motion` → Expected: FAIL

- [ ] **Step 2: 实现 motion**

```ts
// src/shared/motion.ts
import { STAGE_W_CSS, STAGE_H_CSS } from './config'
import type { Point, Rect } from './types'

export type Facing = 'left' | 'right'

/** 自主走动的位移积分。边界用舞台矩形夹取，身体永不越界由调用方再算 sideAllow。 */
export function createMotion(bounds: Rect, speedPxPerSec: number, start: Point, face: Facing = 'right') {
  let pos: Point = { ...start }
  let facing: Facing = face
  const maxX = bounds.x + bounds.w - STAGE_W_CSS
  const minX = bounds.x
  return {
    pos: () => ({ ...pos }),
    facing: () => facing,
    setFacing(f: Facing) { facing = f },
    setPosition(p: Point) { pos = { ...p } },
    snapToBottom() { pos.y = bounds.y + bounds.h - STAGE_H_CSS },
    step(dtMs: number): Point {
      if (dtMs <= 0 || speedPxPerSec <= 0) return pos
      const d = (speedPxPerSec * dtMs) / 1000
      let nx = pos.x + (facing === 'right' ? d : -d)
      if (nx > maxX) { nx = maxX; facing = 'left' }
      else if (nx < minX) { nx = minX; facing = 'right' }
      pos = { ...pos, x: nx }
      return pos
    },
  }
}
```

- [ ] **Step 3: 舞台 DOM 与样式（透明度交叉淡入是铁律④的落点）**

```css
/* src/renderer/style.css */
html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden }
#root { position: relative; width: 100%; height: 100% }
.pet-sprite { position: absolute; pointer-events: none; left: 0; top: 0 }
.pet-stage { position: relative; width: 320px; height: 180px }
.pet-video {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: contain; pointer-events: none; opacity: 0;
  transition: opacity 0.18s ease;          /* 铁律④ */
}
.pet-video.is-front { opacity: 1 }
.pet-video.flip { transform: scaleX(-1) }  /* 镜像换向，不重做素材 */
.hit-outline { position: absolute; border: 1px solid rgba(255,0,0,.6); pointer-events: none }
```

```ts
// src/renderer/sprite.ts
import { STAGE_W_CSS, STAGE_H_CSS } from '../shared/config'

export function createSprite(root: HTMLElement) {
  const wrap = document.createElement('div'); wrap.className = 'pet-sprite'
  const stage = document.createElement('div'); stage.className = 'pet-stage'
  stage.style.width = `${STAGE_W_CSS}px`; stage.style.height = `${STAGE_H_CSS}px`
  wrap.appendChild(stage); root.appendChild(wrap)
  let debugBox: HTMLDivElement | null = null
  return {
    stage,
    moveTo(x: number, y: number) { wrap.style.transform = `translate(${x}px, ${y}px)` },
    /** 命中区可视化开关：设计文档第 3 节第 4 条保护 */
    showOutline(rect: { x: number; y: number; w: number; h: number } | null) {
      if (!rect) { debugBox?.remove(); debugBox = null; return }
      debugBox ??= document.createElement('div')
      debugBox.className = 'hit-outline'
      debugBox.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;position:absolute;border:1px solid rgba(255,0,0,.6);pointer-events:none`
      root.appendChild(debugBox)
    },
  }
}
```

- [ ] **Step 4: 装配主流程（行为链 + 悬停 + 续期 + 拖拽）**

```ts
// src/renderer/index.ts
import { createVideoPlayer } from './player/video-backend'
import { createPicker } from '../shared/behavior'
import { createRuleEngine } from '../shared/rules'
import { createHoverTimer } from '../shared/hover'
import { createMotion } from '../shared/motion'
import { bodyRect, anyContains } from '../shared/geometry'
import { STAGE_W_CSS, CANVAS_W } from '../shared/config'
import { createSprite } from './sprite'
import type { LoadedSkin } from '../shared/skin-store-types'

declare global {
  interface Window {
    petBridge?: {
      onCursor(cb: (p: { x: number; y: number }) => void): void
      onSkin(cb: (s: LoadedSkin | { errors: string[] }) => void): void
      requestGrab(on: boolean): void
    }
  }
}

const root = document.getElementById('root')!

/** 皮肤由主进程装载校验后经消息送进来；渲染层不碰 node:fs。 */
function bootstrap(skin: LoadedSkin) {
  const sprite = createSprite(root)
  const urlCache = new Map<string, string>()
  const player = createVideoPlayer(sprite.stage, (ref) => {
    const k = `${ref.pool}/${ref.name}`
    let u = urlCache.get(k)
    if (!u) {
      // skin.dir 是绝对路径（Task 5 已 resolve），Windows 反斜杠要换掉才能当 URL 用
      u = 'file:///' + `${skin.dir}/animation/${ref.pool}/${ref.name}.webm`.replace(/\\/g, '/')
      urlCache.set(k, u)
    }
    return u
  })
const picker = createPicker(Math.random)
const rules = createRuleEngine(Date.now, 20000)
const hover = createHoverTimer(Date.now)
const motion = createMotion({ x: 0, y: 0, w: innerWidth, h: innerHeight }, 40, { x: innerWidth / 2 - STAGE_W_CSS / 2, y: 0 })
motion.snapToBottom()

let current = picker.pickFrom(skin, 'idle', null)!
let lastTick = Date.now()

function playPool(pool: string, once = true) {
  const ref = picker.pickFrom(skin, pool, current)
  if (!ref) return
  current = ref
  const box = bodyRect(skin.manifest, motion.pos())
  sprite.moveTo(box.x, box.y)
  void player.play(ref, { once })
}

function loop() {
  const now = Date.now()
  motion.step(now - lastTick); lastTick = now
  const box = bodyRect(skin.manifest, motion.pos())
  sprite.moveTo(box.x, box.y)
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

// 行为链：播完一条 → 规则层给下一个池 → 抽一条
;(async function chain() {
  while (true) {
    const r = await player.play(current, { once: rules.state === 'active' })
    if (r === 'cancelled') continue
    const pool = rules.feed('tick')
    const next = picker.pickFrom(skin, pool, current)
    if (next) current = next
  }
})()

window.petBridge?.onCursor((p) => {
  const local = { x: p.x, y: p.y }
  const overBody = anyContains([bodyRect(skin.manifest, motion.pos())], local)
  const ev = hover.onPoint(local, overBody, false /* 面板矩形由 panel.ts 提供 */)
  if (ev === 'open') playPool('click', true)
  rules.feed(Date.now() - lastTick > 20000 ? 'idle-long' : 'tick')
  window.petBridge?.requestGrab(overBody || hover.isOpen)
})

// 调试钩子（e2e 依赖它）
;(window as unknown as { __testPlay: (p: string, n: string, once: boolean) => Promise<string> }).__testPlay =
  (pool, name, once) => player.play({ pool, name }, { once })
}

window.petBridge?.onSkin((s) => {
  if ('errors' in s) {
    // 皮肤不合法就大声报错，不静默换默认皮肤（设计文档第 5 节的装载语义）
    const pre = document.createElement('pre')
    pre.textContent = s.errors.join('\n')
    root.appendChild(pre)
    return
  }
  bootstrap(s)
})
```

- [ ] **Step 5: 验证渲染层没有摸到主进程模块**

`skinLoaded` 消息与 `onSkin` 已在 Task 4 建好，本步只做验证：渲染层通过 `onSkin` 拿到主进程校验过的皮肤，不 import 任何 `src/main` 下的东西（`node:fs` 在渲染层不可用）。

```bash
grep -rn "src/main\|from '../main\|require('fs'\|node:fs" src/renderer/ || echo "renderer 不依赖 main ✔"
```
Expected: `renderer 不依赖 main ✔`。若命中，说明有人把装载逻辑写进了渲染层，改回 Step 4 的 `bootstrap(skin)` 形式。

注意 `LoadedSkin` 类型来自 `src/shared/skin-store-types.ts`（Task 7 Step 4 建），纯类型 + 纯路径拼接，无 `node:fs` 依赖，可以安全被渲染层 import。

- [ ] **Step 6: 真机验收**

```bash
npm run build && npx electron dist/main/index.js
```
Expected（逐项确认并截图存档）：
1. 一个绿色色块出现在工作区底部中央，左右来回走。
2. 色块背景透明 —— 桌面图标透过它可见，且它四周**没有灰色矩形底**（若有，跑 `node tools/alpha-report.mjs` 定位是哪段素材脏）。
3. 鼠标在色块外：桌面正常点击穿透。
4. 鼠标停在色块上 400ms：播一次被点动画（面板在 Task 12）。
5. 拖动色块：位置跟随光标，松手停在原地，不跳回。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/ src/shared/motion.ts src/shared/ipc.ts src/main/index.ts src/preload/index.cjs test/motion.test.ts
git commit -m "feat: 渲染层装配 — 位置积分、行为链、悬停触发与鼠标续期"
```

---

## Task 11: 存档（save.json + version + 备份 + stats 通道）

**Files:**
- Create: `src/shared/save.ts`, `src/main/paths.ts`, `src/main/storage.ts`, `test/save.test.ts`, `test/storage.test.ts`

**Interfaces:**
- Consumes: `SAVE_VERSION`、`SAVE_FILE`
- Produces:
  - `type SaveData = { version: number; skin: string; stats: Stats; lastSeenAt: number }`
  - `type Stats = { hunger: number; mind: number; clean: number; mood: number }`（v1 保留字段与固定值，不参与判断）
  - `defaultSave(): SaveData`、`migrate(raw: unknown): SaveData`
  - `saveTo(dir: string, data: SaveData): void`（写前把旧文件复制成 `save.json.bak`）
  - `loadFrom(dir: string): SaveData`（损坏时回退 `.bak`，都坏则用默认值并记录一次警告）
  - `platformDataDir(appName: string): string`

- [ ] **Step 1: 写迁移与损坏回退的失败测试**

```ts
// test/save.test.ts
import { describe, it, expect } from 'vitest'
import { defaultSave, migrate } from '../src/shared/save'

describe('migrate', () => {
  it('无文件时用默认值', () => {
    const s = migrate(null)
    expect(s.version).toBe(1)
    expect(s.stats).toEqual({ hunger: 80, mind: 80, clean: 80, mood: 80 })
  })
  it('保留已有字段，补齐缺失字段', () => {
    const s = migrate({ version: 1, skin: 'block', stats: { hunger: 30 } })
    expect(s.skin).toBe('block')
    expect(s.stats.hunger).toBe(30)
    expect(s.stats.mood).toBe(80)      // 缺失补默认
  })
  it('版本高于支持范围时拒绝而不猜（记 error，用默认值继续跑）', () => {
    const r = migrate({ version: 99 })
    expect(r.version).toBe(1)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
  it('垃圾输入不抛异常', () => {
    expect(() => migrate('not json')).not.toThrow()
    expect(migrate([]).version).toBe(1)
  })
})
```

- [ ] **Step 2: 实现存档类型与迁移**

```ts
// src/shared/save.ts
import { SAVE_VERSION } from './config'

export type Stats = { hunger: number; mind: number; clean: number; mood: number }
export type SaveData = { version: number; skin: string; stats: Stats; lastSeenAt: number; warnings: string[] }

const DEFAULT_STATS: Stats = { hunger: 80, mind: 80, clean: 80, mood: 80 }

export function defaultSave(): SaveData {
  return { version: SAVE_VERSION, skin: 'block', stats: { ...DEFAULT_STATS }, lastSeenAt: Date.now(), warnings: [] }
}

/** 永远不抛异常：损坏就回退默认值并把原因记在 warnings 里。 */
export function migrate(raw: unknown): SaveData {
  const base = defaultSave()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...base, warnings: ['存档无法识别，已用默认值'] }
  }
  const r = raw as Record<string, unknown>
  const warnings: string[] = []
  if (typeof r.version === 'number' && r.version > SAVE_VERSION) {
    warnings.push(`存档版本 ${r.version} 高于本程序支持的 ${SAVE_VERSION}，按默认值处理`)
  }
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const st = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>
  return {
    version: SAVE_VERSION,
    skin: typeof r.skin === 'string' ? r.skin : base.skin,
    stats: {
      hunger: num(st.hunger, DEFAULT_STATS.hunger),
      mind: num(st.mind, DEFAULT_STATS.mind),
      clean: num(st.clean, DEFAULT_STATS.clean),
      mood: num(st.mood, DEFAULT_STATS.mood),
    },
    lastSeenAt: num(r.lastSeenAt, base.lastSeenAt),
    warnings,
  }
}

/**
 * 数值写入的唯一入口。第一版按钮不经过它改数值，但通道在此定死，
 * 第二轮加衰减时只改这个函数体，不动存档结构、不动面板、不动读写。
 */
export function applyCare(save: SaveData, action: 'feed' | 'wash' | 'play', by: Partial<Stats> = {}): SaveData {
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  return { ...save, stats: { ...save.stats, ...by, hunger: by.hunger !== undefined ? clamp(by.hunger) : save.stats.hunger } }
}
```

Run: `npm run test -- save` → Expected: 4 passed

- [ ] **Step 3: 写原子落盘的失败测试**

```ts
// test/storage.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveTo, loadFrom } from '../src/main/storage'
import { defaultSave } from '../src/shared/save'

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pet-')) })

describe('saveTo / loadFrom', () => {
  it('第二次写入会留下上一次的 .bak', () => {
    saveTo(dir, { ...defaultSave(), skin: 'a' })
    saveTo(dir, { ...defaultSave(), skin: 'b' })
    expect(existsSync(join(dir, 'save.json.bak'))).toBe(true)
    const bak = JSON.parse(readFileSync(join(dir, 'save.json.bak'), 'utf8'))
    expect(bak.skin).toBe('a')
  })
  it('主文件损坏时自动读 .bak', () => {
    saveTo(dir, { ...defaultSave(), skin: 'good' })
    saveTo(dir, { ...defaultSave(), skin: 'newer' })
    readFileSync(join(dir, 'save.json'), 'utf8')
    const { writeFileSync } = require('node:fs')
    writeFileSync(join(dir, 'save.json'), '{ 坏掉的 json')
    expect(loadFrom(dir).skin).toBe('newer')   // .bak 里是 good？→ 见 Step 4 语义：回退到最近一次完整写入
  })
  it('没有文件时返回默认值且不创建文件', () => {
    const s = loadFrom(dir)
    expect(s.skin).toBe('block')
    expect(existsSync(join(dir, 'save.json'))).toBe(false)
  })
})
```

Run: `npm run test -- storage` → Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现落盘（原子写：临时文件 + rename，配合 .bak 备份）**

```ts
// src/main/storage.ts
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAVE_FILE } from '../shared/config'
import { defaultSave, migrate, type SaveData } from '../shared/save'

const file = (dir: string) => join(dir, SAVE_FILE)
const backup = (dir: string) => join(dir, `${SAVE_FILE}.bak`)

export function saveTo(dir: string, data: SaveData): void {
  const json = JSON.stringify({ ...data, warnings: undefined }, null, 2)
  if (existsSync(file(dir))) copyFileSync(file(dir), backup(dir))   // 先把上一版留档
  const tmp = `${file(dir)}.tmp`
  writeFileSync(tmp, json, 'utf8')
  renameSync(tmp, file(dir))                                        // rename 保证不会写出半个文件
}

export function loadFrom(dir: string): SaveData {
  if (!existsSync(file(dir))) return defaultSave()
  try {
    return migrate(JSON.parse(readFileSync(file(dir), 'utf8')))
  } catch {
    if (existsSync(backup(dir))) {
      try { return migrate(JSON.parse(readFileSync(backup(dir), 'utf8'))) } catch { /* 备份也坏，落到默认 */ }
    }
    return { ...defaultSave(), warnings: ['主存档与备份均无法解析，已重置'] }
  }
}
```

- [ ] **Step 5: 平台数据目录（禁止硬编码 APPDATA）**

```ts
// src/main/paths.ts
import { app } from 'electron'
import { join } from 'node:path'

/** 唯一的路径出口。macOS 迁移时只改这里。 */
export function platformDataDir(): string {
  return app.getPath('userData')          // win32: %APPDATA%\<app>，darwin: ~/Library/Application Support/<app>
}
export const saveDir = () => platformDataDir()
export const skinDirs = () => [join(app.getAppPath(), 'skins'), join(platformDataDir(), 'skins')]
```

Run: `npm run test && npm run typecheck` → Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add src/shared/save.ts src/main/storage.ts src/main/paths.ts test/save.test.ts test/storage.test.ts
git commit -m "feat: 存档读写（原子写 + .bak 回退 + 版本迁移）与平台目录"
```

---

## Task 12: 悬停面板与控件矩形

用户要求的可见功能：悬停 400ms 出面板，按钮切动画。

**Files:**
- Create: `src/renderer/panel.ts`, `test/panel-dom.test.ts`, `e2e/panel.spec.ts`
- Modify: `src/renderer/index.ts`, `src/renderer/style.css`, `src/main/clickthrough.ts`

**Interfaces:**
- Consumes: `createHoverTimer`、`bodyRect`、`IPC.cursor`、`ClipPlayer.play`
- Produces:
  - `createPanel(root: HTMLElement, actions: PanelAction[])` → `{ rect(): Rect | null; show(at: Point): void; hide(): void }`
  - `type PanelAction = { id: string; label: string; pool: string }`

- [ ] **Step 1: 写面板动作定义的失败测试（用 jsdom 环境）**

```ts
// test/panel-dom.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createPanel, defaultActions } from '../src/renderer/panel'

describe('createPanel', () => {
  it('默认五个动作对应五个必需池', () => {
    expect(defaultActions().map((a) => a.pool)).toEqual(['idle', 'move', 'turn', 'click', 'drag'])
  })
  it('show 后能拿到控件矩形，hide 后为 null', () => {
    const root = document.createElement('div'); document.body.replaceChildren(root)
    const p = createPanel(root, defaultActions(), vi.fn())
    p.show({ x: 100, y: 100 })
    const r = p.rect()
    expect(r).not.toBeNull()
    expect(r!.w).toBeGreaterThan(0)
    p.hide()
    expect(p.rect()).toBeNull()
  })
  it('点按钮回调带上动作 id', () => {
    const root = document.createElement('div'); document.body.replaceChildren(root)
    const onClick = vi.fn()
    const p = createPanel(root, defaultActions(), onClick)
    p.show({ x: 0, y: 0 })
    const btn = root.querySelector('button[data-pool="move"]')!
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ pool: 'move' }))
  })
  it('面板自身可点（不能是 pointer-events:none）', () => {
    const root = document.createElement('div'); document.body.replaceChildren(root)
    const p = createPanel(root, defaultActions(), vi.fn())
    p.show({ x: 0, y: 0 })
    expect(p.el.style.pointerEvents).toBe('auto')
  })
})
```

需要装 jsdom：`npm i -D jsdom`（加进开发依赖白名单，仅测试用）。

Run: `npm run test -- panel` → Expected: FAIL

- [ ] **Step 2: 实现面板**

```ts
// src/renderer/panel.ts
import type { Rect, Point } from '../shared/types'

export type PanelAction = { id: string; label: string; pool: string }

export function defaultActions(): PanelAction[] {
  return [
    { id: 'idle', label: '待机', pool: 'idle' },
    { id: 'move', label: '走走', pool: 'move' },
    { id: 'turn', label: '转身', pool: 'turn' },
    { id: 'click', label: '回应', pool: 'click' },
    { id: 'drag', label: '抓一把', pool: 'drag' },
  ]
}

export function createPanel(root: HTMLElement, actions: PanelAction[], onClick: (a: PanelAction) => void) {
  const el = document.createElement('div')
  el.className = 'pet-panel'
  el.style.pointerEvents = 'auto'
  el.setAttribute('role', 'toolbar')
  el.hidden = true
  for (const a of actions) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = a.label
    b.dataset.pool = a.pool
    b.addEventListener('click', () => onClick(a))
    el.appendChild(b)
  }
  root.appendChild(el)

  let at: Point | null = null
  return {
    el,
    show(p: Point) { at = p; el.hidden = false; el.style.transform = `translate(${p.x}px, ${p.y}px)` },
    hide() { at = null; el.hidden = true },
    /** 控件矩形上报给穿透判定：面板在屏幕上占哪一块 */
    rect(): Rect | null {
      if (!at) return null
      return { x: at.x, y: at.y, w: el.offsetWidth, h: el.offsetHeight }
    },
  }
}
```

```css
/* src/renderer/style.css 追加 */
.pet-panel {
  position: absolute; left: 0; top: 0;
  display: flex; gap: 6px; padding: 6px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
  font: 12px "Microsoft YaHei UI", sans-serif;
  opacity: 0; transition: opacity 0.18s ease; pointer-events: none;
}
.pet-panel:not([hidden]) { opacity: 1 }
.pet-panel button {
  border: 1px solid rgba(0,0,0,.14); border-radius: 6px;
  background: rgba(255,255,255,.9); padding: 4px 8px; cursor: pointer;
}
```

> 注意 `opacity` 过渡会让 `offsetWidth` 在刚显示时为真实值（因为元素已参与布局），控件矩形上报不会拿到 0。

- [ ] **Step 3: 接线：面板参与命中，且打开期间持续续期**

`src/renderer/index.ts` 里把光标回调换成：

```ts
const panel = createPanel(root, defaultActions(), (a) => {
  rules.feed('interacted')
  const ref = picker.pickFrom(skin, a.pool, current)
  if (ref) { current = ref; void player.play(ref, { once: true }) }
})

window.petBridge?.onCursor((p) => {
  const overBody = anyContains([bodyRect(skin.manifest, motion.pos())], p)
  const pr = panel.rect()
  const overPanel = pr ? anyContains([pr], p) : false
  const ev = hover.onPoint(p, overBody, overPanel)
  if (ev === 'open') {
    const b = bodyRect(skin.manifest, motion.pos())
    panel.show({ x: b.x, y: Math.max(0, b.y - 40) })   // 面板贴在身体上方，越界则夹回顶边
  }
  if (ev === 'close') panel.hide()
  // 身体或面板任一需要鼠标 → 请求接住；每帧都发，主进程据此续租
  window.petBridge?.requestGrab(overBody || overPanel)
})
```

- [ ] **Step 4: 主进程加租约心跳（渲染层每帧请求，主进程每 33ms sweep）**

`src/main/index.ts` 的 sweep 定时器已存在（Task 4）。补一条：`requestGrab(false)` 之外**也要更新 lastSeen**，否则渲染层只想放开时会被 sweep 反复判定为状态变化。修改 `clickthrough.ts`：

```ts
request(grab: boolean): boolean {
  const changed = lease.tick(grab)
  if (changed) platform.setInteractive(lease.interactive)
  return changed
}
```
改为：`tick(false)` 分支也刷新 `lastRenew = opts.now()` —— 渲染层在「不需要鼠标」时同样在心跳，主进程不该把「长时间只想放开」误判成「渲染层死了」。这个改动不影响 Task 8 的四个用例：超时那条测的是 `tick(true)` 之后再无请求，`lastRenew` 停留在开启时刻，`sweep` 依旧在 501ms 释放；「want=false 立刻放开」那条只断言返回值与 `interactive`，与 `lastRenew` 无关。

Run: `npm run test -- lease` → Expected: 4 passed（若有用例失败，说明实现与上面的语义描述不一致，以实现为准回读本段并改正其中一方，不要改断言凑绿）

- [ ] **Step 5: 取消 e2e 的 skip 并跑**

```ts
// e2e/panel.spec.ts
import { test, expect, _electron as electron } from 'playwright'

test('悬停满 400ms 出现面板，点按钮切换动画', async () => {
  const app = await electron.launch({ args: ['dist/main/index.js'] })
  const win = await app.firstWindow()
  const box = await win.evaluate(() => {
    const b = document.querySelector('.pet-sprite')!.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  await win.mouse.move(box.x, box.y)
  for (let i = 0; i < 20; i++) { await win.waitForTimeout(30); await win.mouse.move(box.x + (i % 2), box.y) }
  await expect(win.locator('.pet-panel button')).toHaveCount(5)
  await win.click('.pet-panel button[data-pool="move"]')
  const pool = await win.evaluate(() => (window as never as { __dbg(): { pool: string } }).__dbg().pool)
  expect(pool).toBe('move')
  await app.close()
})
```

`src/renderer/index.ts` 增加 `__dbg`：

```ts
;(window as unknown as { __dbg: () => { pool: string; interactive: boolean } }).__dbg =
  () => ({ pool: current.pool, interactive: hover.isOpen })
```

Run: `npm run build && npx playwright test e2e` → Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/renderer/panel.ts src/renderer/index.ts src/renderer/style.css test/panel-dom.test.ts e2e/panel.spec.ts package.json package-lock.json
git commit -m "feat: 悬停面板与控件矩形上报，按钮切换动画"
```

---

## Task 13: 全屏让路与调试开关

**Files:**
- Create: `src/main/fullscreen.ts`, `test/fullscreen.test.ts`
- Modify: `src/main/index.ts`, `src/preload/index.cjs`, `src/renderer/index.ts`

**Interfaces:**
- Consumes: `Platform.show/hide`
- Produces: `mapNotificationState(s: number, isPetForeground: boolean): boolean`（返回「宠物该让路吗」）、`startFullscreenWatch(platform, nativeWindowHandle): () => void`

- [ ] **Step 1: 写映射的失败测试（纯函数，测的是数字含义不是 PowerShell）**

```ts
// test/fullscreen.test.ts
import { describe, it, expect } from 'vitest'
import { mapNotificationState } from '../src/main/fullscreen'

describe('mapNotificationState', () => {
  it('2 全屏应用 / 3 D3D 全屏 / 4 演示模式 → 让路', () => {
    for (const s of [2, 3, 4]) expect(mapNotificationState(s, false)).toBe(true)
  })
  it('前台窗口就是宠物自己时不让路（宠物窗覆盖整屏，会被误判成全屏）', () => {
    expect(mapNotificationState(2, true)).toBe(false)
  })
  it('0 空闲、1 全屏应用但不在前台 → 不让路', () => {
    expect(mapNotificationState(0, false)).toBe(false)
    expect(mapNotificationState(1, false)).toBe(false)
  })
  it('非法值不让路（不猜）', () => {
    expect(mapNotificationState(99, false)).toBe(false)
    expect(mapNotificationState(-1, false)).toBe(false)
  })
})
```

- [ ] **Step 2: 实现探测（含关机期禁止启动子进程的保护）**

```ts
// src/main/fullscreen.ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Platform } from './platform'

const SCRIPT = (petHandle: string) => `
$ErrorActionPreference='Stop'
Add-Type -Namespace Q -Name W -MemberDefinition '
[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
while ($true) {
  $s=0
  [void][Q.W]::SHQueryUserNotificationState([ref]$s)
  [Console]::WriteLine([int]($s -ge 2 -and $s -le 4 -and [Q.W]::GetForegroundWindow() -ne [IntPtr]${petHandle}))
  Start-Sleep -Milliseconds 500
}`

/** 让路判定：状态在 2..4 且前台不是宠物自己。 */
export function mapNotificationState(state: number, isPetForeground: boolean): boolean {
  if (isPetForeground) return false
  return state >= 2 && state <= 4
}

export function startFullscreenWatch(platform: Platform, petHandle: string): () => void {
  if (process.platform !== 'win32') return () => {}
  let dying = false
  let ps: ChildProcessWithoutNullStreams | null = null
  try {
    ps = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT(petHandle), 'utf16le').toString('base64')],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })   // 隐藏控制台，避免开机闪窗
  } catch { return () => {} }

  let hiding = false
  createInterface({ input: ps.stdout }).on('line', (line) => {
    if (dying) return
    const shouldHide = line === '1'
    if (shouldHide === hiding) return
    hiding = shouldHide
    if (hiding) platform.hide(); else platform.show()
  })
  ps.on('error', () => { /* 探测失败不影响宠物存在，静默 */ })

  // 关机/注销时不得再派生子进程，且要把已存在的收掉
  const bye = () => { dying = true; ps?.kill() }
  process.on('exit', bye)
  return () => { dying = true; ps?.kill(); process.off('exit', bye) }
}
```

- [ ] **Step 3: 接线 + 快捷键开命中区可视化**

`src/main/index.ts` 里窗口建好后：

```ts
import { startFullscreenWatch } from './fullscreen'
const stopWatch = startFullscreenWatch(platform, win.getNativeWindowHandle().readBigUInt64LE().toString())
app.on('before-quit', stopWatch)
```

`src/shared/ipc.ts` 增加 `debugOverlay: 'pet:debug-overlay'`；preload 增加 `toggleDebug`；`src/renderer/index.ts` 绑定键盘：

```ts
window.addEventListener('keydown', (e) => {
  if (e.key === 'F9') {
    debugOn = !debugOn
    sprite.showOutline(debugOn ? bodyRect(skin.manifest, motion.pos()) : null)
  }
})
```

- [ ] **Step 4: 真机验收**

```bash
npm run build && npx electron dist/main/index.js
```
Expected：
1. 按 F9 出现红色身体框，再按消失；框随宠物移动。
2. 打开一个全屏视频（浏览器全屏播放）→ 宠物隐藏；退出全屏 → 宠物恢复。
3. 宠物自己获得焦点时不隐藏（用面板按钮验证）。
4. 任务管理器里**没有**多余的 powershell 窗口闪现；退出程序后 `Get-Process powershell` 不再有本项目的残留。

Run: `npm run test && npm run typecheck && npm run e2e` → Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add src/main/fullscreen.ts src/main/index.ts src/shared/ipc.ts src/preload/index.cjs src/renderer/index.ts test/fullscreen.test.ts
git commit -m "feat: 全屏应用让路探测与命中区调试开关"
```

---

## Task 14: v1 端到端验收与文档回写

**Files:**
- Modify: `docs/桌宠-Windows实现方案.html`（第 3 节 spike 结论、第 14 节未决事项）、`README.md`

**Interfaces:**
- Consumes: 前面全部任务
- Produces: 一份验收记录 + 一份「怎么自定义皮肤」说明

- [ ] **Step 1: 跑全部测试并记录数字**

```bash
npm run typecheck && npm run test && npm run build && npm run e2e
```
Expected: 无失败。把用例数与耗时记进 `README.md` 的验收小节。

- [ ] **Step 2: 皮肤替换测试（自定义皮肤这条轴的唯一端到端验证）**

```bash
cp -r skins/block skins/mine
# 改 skins/mine/manifest.json 的 name 为 "我的宠物"
node tools/alpha-report.mjs skins/mine/animation/idle/patrol.webm
```
Expected: 体检 `haze:false`；主进程装载日志显示新名字。再故意做一次破坏验证：

```bash
node -e "import('./dist/main/skin-store.js').then(m=>console.log(m.loadSkin('skins/坏皮肤')))"
```
Expected: 打印 `errors` 且明确指出缺哪条必需池，不抛栈、不静默回退。

- [ ] **Step 3: 写 README**

必含小节：怎么跑起来（三条命令）、怎么自定义皮肤（目录结构 + manifest 字段表 + 素材合同「首末帧同姿势」）、常见故障（灰底 → 跑体检；面板点不动 → 查穿透租约日志；全屏时被遮住 → F9 看窗口位置）。皮肤说明要能让没读过本计划的人照着做出一个能装载的包。

- [ ] **Step 4: 回写设计文档**

把 Task 3 的 spike 结论落到设计文档第 3 节（保留还是退路），并把第 14 节里已被 v1 触及的条目更新。若 spike 走了退路，同步修正第 3、4 节的措辞。

- [ ] **Step 5: 提交并打标签**

```bash
git add README.md docs/桌宠-Windows实现方案.html
git commit -m "docs: v1 验收记录与自定义皮肤说明"
git tag v0.1.0
```

---

## 自查结论（写完后按 checklist 回看）

**1. 覆盖检查** — 设计文档的 v1 要素逐条对到了任务：整屏覆盖窗（T4）、鼠标穿透与租约兜底（T4/T8/T12）、光标推进（T4）、皮肤契约与校验与必需池拒绝装载（T5）、动画按名字寻址与名字安全（T5）、透明通道残留体检（T2）、蓝幕抠像管线（T2）、ClipPlayer 接口与四铁律（T7）、随机层可注入种子 + 规则层可注入时钟（T9）、悬停 400ms（T8/T12）、控件矩形上报（T12）、面板按钮切动画（T12）、stats 节点与写入通道而不写衰减（T11）、存档 version 与 .bak（T11）、平台目录函数化（T11）、全屏让路（T13）、命中区调试开关（T13）、硬件加速保持开启（T3/T4）、spike 优先（T3）、退路方案（T3 Step 4）。设计文档第 12 节的 v1 清单九项全部有对应任务。

**2. 占位符扫描** — 无 TBD/TODO/「适当处理」。两处刻意保留的判断已在正文写明理由：preload 消息名字符串内联（contextBridge 限制，且由测试锁定）、e2e 用例在 T7 建为 skip 到 T10 启用。

**3. 类型一致性** — `Rect/Point/Box` 全部来自 `src/shared/types.ts`；`ClipRef` 只在 `clip-player.ts` 定义并被 T9/T10/T12 引用；`bodyRect(manifest, petPos, override?)` 在 T6 定义、T10/T12/T13 调用签名一致；`Platform` 的六个方法在 T4 定义，T11 的 `paths.ts` 不扩展它（避免接口膨胀），T13 用 `platform.show/hide`。

## 已知风险，执行时要盯

- Task 3 的 spike 是唯一可能推翻架构的任务，必须在任何生产代码之前完成。
- Task 10 第 4 步那段装配代码是全项目耦合最紧的一处，若 `loadeddata` 在本地文件上从不触发（Electron 对 `file://` 流式播放的行为需要实测），按 Task 7 的 `prepare` + `urlCache` 路径改为 blob 加载，dsh-pet 的浏览器端就是这么做的。
- Task 12 的面板矩形在 `opacity` 过渡期间取 `offsetWidth` 是安全的，但如果面板改成 `display:none` 布局就会拿到 0 —— 别改这个显隐方式。
