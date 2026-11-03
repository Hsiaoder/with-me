# 桌宠 v1（Windows）· 功能规格

| 项 | 值 |
|---|---|
| 状态 | 生效中。第 4 节的架构约束已真机验证 |
| 日期 | 2026-11-02 生成，同日按 spike 与 Task 4 实测结果修订 |
| 设计理由 | [桌宠-Windows实现方案.html](../../桌宠-Windows实现方案.html) —— 为什么这样选，看那份 |
| 结构总纲 | [架构大纲](../../架构大纲.md) —— 系统由哪几块组成 |
| 施工单 | [实现计划](../plans/2026-11-02-desktop-pet-v1.md) —— 14 个任务，逐步做什么 |
| 实测证据 | [spike/README.md](../../../spike/README.md) |
| 皮肤契约 | [皮肤包契约 spec](2026-11-02-skin-pack-contract.md) |

**这份文件负责什么**：规定 v1 交付什么、怎么算验收、哪些约束不可协商。它不重复论证选型理由，也不列施工步骤。与前三份冲突时，以本文件的**第 4 节约束**和**第 7 节验收**为准——那两节是实测过的，其余三份里有几处写在它们之前。

---

## 1. 要解决的问题

Windows 桌面上站一只宠物：它自己按规则和权重播动画，鼠标停上去出按钮面板，点按钮换动作，其余区域鼠标完全穿透到下面的窗口。角色本身要能整个换掉——换一只宠物等于换一个目录，不改代码。

## 2. 范围

**v1 交付**

| 能力 | 做到什么程度 |
|---|---|
| 桌面存在 | 整屏透明覆盖窗，宠物站在桌面上，置顶，不抢任务栏 |
| 播放动画 | 预渲染的带 alpha webm，双播放器无缝衔接 |
| 自主行为 | 规则层管反应（被点/被拖）与「多久没人理」；久无人理之后规则层**交出选池决策权**，由随机层按 manifest 权重在 idle/move/turn 里抽 |
| 悬停面板 | 光标停留满 400ms 弹按钮，点按钮切动作池，离开满 400ms 收起。计时到点**自己完成**：主进程对相同坐标去重，手停住时不会有第二次光标事件，所以渲染层必须自己挂定时器催 |
| 鼠标穿透 | 非交互区域穿透到下面；关闭穿透带 500ms 超时兜底 |
| 换皮肤 | 按契约做的目录即皮肤；不合法就拒绝装载并逐条说明 |
| 存档 | `save.json` 原子写 + `.bak` 备份 + 版本字段；`stats` 通道冻结但衰减逻辑不实现 |
| 全屏让路 | 检测到全屏应用时隐藏宠物 |
| 命中区可视化 | Ctrl+Shift+点身体切换 `bodyBox` 框。排查"鼠标停在身上不响应"这类问题没有它就是猜。不用 F9：窗口故意 `focusable: false`，收不到键盘事件；改用全局快捷键又会把 F9 从所有应用手里抢走 |

**v1 明确不做**：多宠物、数值衰减与离线补算、小游戏、agent 接入、换装、macOS 实现（只保留 `Platform` 接口形状）、安装包与自动更新、皮肤在线下载。

## 3. 已证实的事实

这一节是 spike 的产出。写在这里是因为它会推翻别人的直觉，后面接手的人不必再验一次。

| 结论 | 证据 |
|---|---|
| 整屏透明覆盖层 + **保留硬件加速**在真机上成立 | 宠物框外 5,804,160 个像素中不透明像素 **0**；真实屏幕差分在覆盖层范围内意外变化像素 **0** |
| 不掉帧 | 24fps 素材，每 10 秒帧计数增量 239–240 |
| 占用可接受 | CPU 稳态 **1.4%**；内存 Browser 115MB / GPU 301MB / Tab 94MB，120 秒无增长趋势 |
| 硬件路径真的在用 | `gpu_compositing: enabled`、`video_decode: enabled`（Intel Arc 130T，200% 缩放） |
| **`<video loop>` 不可用** | 70 秒内 17 次 `waiting`→`playing`，素材正好循环 17 圈。每次回到起点要重新缓冲 |
| 光标推进链路成立 | 506 次采样、10 次命中翻转，抽查坐标与矩形一致 |

测试环境：Windows 10.0.26200 x64，Electron 45.2.1 / Chromium 156.0.8078.75，主屏 1600×1000 @200%。

## 4. 不可协商的约束

违反任一条即打回，不看功能是否正常。

### 4.1 分层依赖

1. `src/shared/**` 不 import `electron`、`node:fs`，不引用 `window`/`document`。这样三层都能复用，且全部可被 vitest 直接测。
2. `src/renderer/**` 不 import `src/main/**`。渲染层拿皮肤靠消息，不靠自己读盘。
3. 除 `src/main/windows.ts` 外，`src/main/**` 不许调用 Electron 的窗口方法。业务要动窗口只能走 `Platform` 的动作。

### 4.2 平台与运行时

4. **禁止调用 `app.disableHardwareAcceleration()`。** 本项目的核心赌注是保留硬件加速 + 整屏透明窗，已验证成立。
5. **不能用 `<video loop>`。** 切动画必须靠双播放器提前 `loadeddata` 再换。
6. **主进程 ESM 入口不许写顶层 `await`。** Electron 等入口模块求值完才触发 `ready`，`await app.whenReady()` 在顶层就是两边互等死锁。写成 `async function main()` 再 `void main()`。
7. **`ipcMain.on` 必须早于 `loadFile`。** 渲染层首帧就会发消息，挂晚了那条消息静默丢失且不报错。
8. 资源根按**主机名**区分：`app://assets/` → `dist`，`app://skin/` → 皮肤的 `animation/` 目录。不能用 `app:///renderer/...` 这种路径首段当根名——standard 协议下 Chromium 会把首段搬进主机位，处理器按首段找根必然 403。
9. 所有相对 import 必须写 `.js` 后缀（Node ESM + `moduleResolution: NodeNext`）。
10. `src/preload/index.cjs` 是零 import 的单文件，通道名就地内联，由测试锁定与 `shared/ipc.ts` 一致。
11. 不用打包器。构建 = `tsc` + 复制 html/css 与 preload。
12. **接住鼠标的请求必须带心跳续期**，不能只在光标移动时发。租约 500ms 不续期就自动放开，而用户完全可能把手停在面板上不动——那时鼠标被放开给桌面，下一次点击就穿到下面的窗口。心跳周期 `GRAB_HEARTBEAT_MS`（250ms）必须明显小于超时，且只在"确实想接住"时按节拍发，不能每帧刷 IPC。

### 4.3 工程纪律

13. 时间、尺寸、池名等常量只在 `src/shared/config.ts` 出现一次。
14. 动画只按名字取。出现 `pools[i]` 这类下标寻址即打回。
15. 时钟与随机源注入，不读全局 `Date.now` / `Math.random`。
16. 出错要大声：皮肤不合法就显示错误列表，存档坏了就在 `warnings` 里留痕，不许静默兜底成"看起来正常"。
17. 不写没有调用方的代码。预留靠接口和字段，不靠空函数。
18. 先写失败测试再实现，测试跑不过不许提交。

## 5. 六个部件的规格

职责细节见[架构大纲第 3 节](../../架构大纲.md)，此处只定"对外承诺什么"。

| 部件 | 对外承诺 | 验收看什么 |
|---|---|---|
| P1 平台层 | `Platform { createWindow, setInteractive, sendCursor, setFocusable, onPageReady, send, show, hide }`；未建窗前调用其余动作抛错 | 窗口尺寸 = 主屏工作区且永不改变；穿透开关生效；窗口方法只出现在 `windows.ts` |
| P2 皮肤包 | `validateManifest(raw)`、`loadSkin(dir)`、`clipFile(...)`、`clipUrl(pool,name)`、`missingRequiredPools(m)`、`isLooping/isMirrorable/bodyBoxOf` | 契约见[皮肤包契约 spec](2026-11-02-skin-pack-contract.md)；错误一次列全，逐条可读 |
| P3 播放器 | `ClipPlayer { prepare, play, cancel, current, generation, destroy }`。**没有 loop 概念**，重复播放由行为层再调 `play()` | 四条铁律 + 不许开 `video.loop`，假实现合同 10 条、真 DOM e2e 7 项 |
| P4 行为调度 | `createRuleEngine(now,idleLongMs).feed(event) → pool \| AMBIENT_POOL`；`createPicker(rng).pickFrom/pickAmbient`；接缝 `nextClip({rules,picker,source,loops,ref}) → {kind:'loop'\|'play', ref}` | 接缝本身是被测对象：`pickAmbient` 曾单测全绿却没人调用，皮肤权重全死在链路外。真机链路另由 e2e 的 `ambientNext` 钩子证明 |
| P5 交互层 | `bodyRect(...)`、`anyContains(...)`、`createHoverTimer(now).onPoint(...) / .pendingMs(now)`、`createPanel(...).rect()` | 停留 400ms 开、离开 400ms 关、租约 500ms 超时兜底，三条都有单测；`pendingMs` 让静止光标也能计时到点自动开合 |
| P6 持久化 | `migrate(raw)`、`saveTo(dir,data)`、`loadFrom(dir)`、`platformDataDir()`、`applyCare(save,action,delta)` | 断电不留半个文件；主档坏读备份、都坏回默认并记 warning；永不抛异常 |

## 6. 三份契约

契约变更要写迁移逻辑，不能原地改字段含义。

### 6.1 IPC 消息表（`src/shared/ipc.ts`，唯一来源，前缀统一 `pet:`）

| 通道 | 方向 | payload |
|---|---|---|
| `pet:cursor` | main → renderer | `{x, y}` 覆盖层内坐标 |
| `pet:skin-loaded` | main → renderer | `LoadedSkin` 或 `{errors: string[]}` |
| `pet:click-through` | renderer → main | `{grab: boolean}` |
| `pet:focusable` | renderer → main | `boolean` |

命中区可视化和点歌都不走 IPC：前者由渲染层本地切换（Ctrl+Shift+点身体），后者直接调播放器。留一条没人发的通道，比少一条通道更糟。

### 6.2 皮肤 manifest

见[皮肤包契约 spec](2026-11-02-skin-pack-contract.md)。`formatVersion` 当前 = 1。

### 6.3 存档 schema（`SAVE_VERSION = 1`）

```jsonc
{
  "version": 1,
  "skin": "block",
  "stats": { "hunger": 80, "mind": 80, "clean": 80, "mood": 80 },
  "lastSeenAt": 1762000000000
}
```

`stats` 四字段在 v1 只存在、值固定、不参与任何判断。写入通道 `applyCare` 建好但不接调用方——衰减公式没有调用方时写了也没人验证，推到 v2 一起测。

## 7. 验收标准

每条要么有测试、要么有可复现的手工步骤。全过才算 v1 完成。

**自动化**（`npm run typecheck && npm test && npm run build && npm run alpha:check && npm run e2e && npm run e2e:skin`）

- [x] `npm run typecheck` 无错误
- [x] `npm test` 全绿：18 个测试文件 165 条，约 1 秒
- [x] `npm run alpha:check` 对内置皮肤 6 段全部 `haze:false`
- [x] 分层依赖：渲染层无 `import '../main/'`，shared 无 `import 'electron'` / `node:fs`，`src/main/` 下只有 `windows.ts` 出现窗口方法
- [x] `npm run e2e`：真 Electron 上 20 项——页面从 `app://` 起来且无异常、rAF 不被节流、两槽且前台唯一且已解码在播、`video.loop` 全为 false、过渡时长 0.18s、`currentTime` 在推进、换片后仍只有一个前台、命中框 = 舞台位置 + bodyBox 缩放、**光标静止满 400ms 自动弹面板**（只喂一次坐标）、五个按钮、面板在身体上方且不溢出屏幕、点 `move` 切池、**光标不动时租约心跳仍在续期**、贴右边缘时面板夹回、拖拽跟随且松手不回弹、Ctrl+Shift+点切换命中框、让路探测子进程已启动、**静止离开后面板自动收起**、**久无人理后由权重抽到 turn/move**、同 userData 的第二实例被锁挡掉、退出不留探测孤儿
- [x] `npm run e2e:skin`：换皮肤这条轴 3 项——用户目录皮肤优先且按存档 id 装载、找不到时回退但留下警告、越界皮肤 id 被拒

**真机（只有这三条需要人，其余都已被上面的自动化覆盖）**

- [ ] 光标在宠物外时，点桌面图标与下方浏览器文字正常响应。程序测不了：要真的点在你桌面的窗口上并观察那边响应
- [ ] 开全屏视频与全屏游戏时宠物自动隐藏，退出后恢复；且任务管理器里没有 powershell 窗口闪现
- [ ] 连续运行 10 分钟，CPU 与内存无增长趋势（120 秒基线已测：CPU 1.4%、Browser 115MB）

**已由自动化或 spike 覆盖，无需再看**

- [x] 宠物站在桌面，边缘无灰雾、无黑边、无矩形底 —— spike 的 580 万像素 alpha=0 + 屏幕差分意外变化为 0
- [x] 动画切换处看不出接缝 —— e2e 的「currentTime 在推进」+「换片后仍只有一个前台」，且 `video.loop` 被断言为 false
- [x] 拖拽到屏幕边缘不越界 —— e2e 的贴边夹取 + `motion.setPosition` 的夹取单测
- [x] 强杀进程后存档不损坏 —— `test/storage.test.ts` 覆盖原子写与 `.bak` 回退六条路径

## 8. 非功能预算

| 项 | 预算 | 依据 |
|---|---|---|
| CPU（空闲播放） | ≤ 3% 单核 | spike 实测 1.4%，留一倍余量 |
| 常驻内存（全进程合计） | ≤ 600MB，收紧目标待定 | spike 实测 556MB：GPU 进程 301MB 是 Chromium 固有开销，Browser 115MB（含截图缓冲，正常态应更低）、Tab 94MB、Utility 46MB |
| 掉帧 | 不允许 | spike 实测 24fps 满帧 |
| 皮肤装载失败 | 必须给出逐条中文错误，不许静默回退 | 契约要求 |
| 穿透失效恢复 | ≤ 500ms | `LEASE_TIMEOUT_MS` |

## 9. 未闭合项

| 项 | 状态 | 影响 |
|---|---|---|
| ~~video 后端没有自动化验证~~ **已闭合** | `e2e/pet-check.mjs`（`npm run e2e`）在真 Electron 上验 20 项，清单见上一节验收列表 | 四铁律不再只靠假实现；悬停开合、自主选池这类**时序与接线**问题也只能在真链路上验 |
| 角色形象授权 | 未定。大肥鱼形象是「署名 · 非商业 · 相同方式共享」，禁商用；「缓存」有完整设定但三视图要重做 | 不阻塞 v1（用色块皮肤），阻塞真实素材进场 |
| 蓝幕抠像脚本 | 占位皮肤走通了 `colorkey` 最简管线，真实角色素材的容差与溢色处理未验 | 影响素材产能，不影响代码结构 |
| 内存基线 | spike 那轮把截图缓冲区算进了 Browser 进程，需要一次不带测量的干净读数；GPU 进程 300MB 左右是否能在真实皮肤下降下来也不知道 | 决定预算能不能从 600MB 收紧 |
| 多显示器 | v1 只覆盖主屏工作区 | 副屏上的宠物不存在；推到 v2 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-02 | 从设计 HTML 与架构大纲生成；spike 结论并入第 3、4 节；`app://` 资源根由路径首段改为按主机名；新增「不能用 `<video loop>`」「入口不能顶层 await」「IPC 监听时序」三条实测约束；验收标准从人眼观察改为自动化 + 可复现手工步骤 |
