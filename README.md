# with-me · Windows 桌面宠物

一只站在桌面上的宠物：自己按规则和权重播动画，鼠标停上去出按钮面板，点按钮换动作，
其余区域鼠标完全穿过它落到下面的窗口。角色可以整个换掉——换一只宠物等于换一个目录。

当前状态：v1 开发中，Windows 首发。macOS 只在平台层留了接口形状，没实现。

---

## 怎么跑起来

```bash
npm install          # 依赖走 npmmirror 镜像，见 .npmrc
npm run skin:test    # 生成占位皮肤的 6 段动画（色块，不需要美术素材）
npm start            # 构建并启动
```

`npm start` 之后桌面上会出现一个绿色色块。它没有美术素材是故意的——
v1 先证明架构成立，角色形象另说（见「文档」一节）。

常用命令：

| 命令 | 做什么 |
|---|---|
| `npm run typecheck` | TypeScript 检查，不产出文件 |
| `npm test` | 纯逻辑单测（18 个文件 165 条，约 1 秒） |
| `npm run build` | `tsc` + 复制 html/css 与 preload。没有打包器 |
| `npm run e2e` | 真 Electron 上验播放器、面板、心跳、让路子进程（16 项） |
| `npm run e2e:skin` | 真 Electron 上验「换皮肤」这条轴（3 项） |
| `npm run alpha:check` | 素材透明通道体检 |
| `npm run progress` | 重新生成 `docs/实现进度.md` |

---

## 怎么用起来

- **悬停**：光标停在宠物身上满 400 毫秒，按钮面板默认从脚底下递出来（脚下挨着屏幕边就翻到头顶）；最后一次交互满 1500 毫秒收起。移开宠物的一瞬间鼠标就还给桌面了，不必等面板收。
- **按钮**：喂食 / 小游戏 / 状态。这一版只把入口摆出来，按下去宠物给一个反应（播一条 click 池），功能本身留给下一版。
- **拖拽**：按住宠物可以拖到桌面任何位置，松手后它继续自己的动作循环。
- **自主行为**：没人理它超过 20 秒，它开始按皮肤 `weights` 自己在待机 / 转身之间抽。
  平行走动（`move`）暂时不在自主池里——这版形象更适合待在原地做小动作，想放回来把
  `AMBIENT_POOLS` 里的 `'move'` 加回去就行，走动那套素材和皮肤契约都没动。
- **可见性设置**：面板第四个按钮「设置」里有两档——「全屏时」「放映时」，各选「陪我」或「隐藏」，
  **默认都陪我**。判据是 Windows 的通知状态（独占全屏 / 演示模式）加上"前台窗口是否铺满整块屏"，
  后者带一张系统外壳排除表，否则锁屏界面会被当成有人在全屏。改了立刻写进存档，不用退出。
- **命中区可视化**：`Ctrl+Shift+点身体` 画出红色身体框，再点一次消失。排查
  「鼠标停在身上没反应」这类问题用得上。（不用 F9：这扇窗故意不可聚焦，收不到键盘事件）

存档在 `%APPDATA%\with-me\save.json`，每次退出时写。用户自己放的皮肤放
`%APPDATA%\with-me\skins\`，同名时优先于内置。

---

## 怎么自定义皮肤

一个皮肤 = 一个目录，里面一份 `manifest.json` 加若干带透明通道的 webm。
完整契约见 [`docs/superpowers/specs/2026-11-02-skin-pack-contract.md`](docs/superpowers/specs/2026-11-02-skin-pack-contract.md)，
这里是速查版。

```
skins/<皮肤id>/
  manifest.json
  animation/
    idle/    patrol.webm  patrol2.webm
    turn/    left.webm
    move/    step.webm
    click/   tapped.webm
    drag/    pulled.webm
```

动画文件的地址由**池名和文件名**拼出来：`animation/<池>/<名字>.webm`。
名字就是文件名（不含后缀），不是数组下标。

### manifest 最小可用版

```jsonc
{
  "formatVersion": 1,
  "name": "我的宠物",
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

| 字段 | 必填 | 规则 |
|---|---|---|
| `formatVersion` | 是 | 只能是 `1`。不认识就拒绝装载并提示升级程序，不猜 |
| `name` | 是 | 展示用 |
| `canvas` | 是 | 必须 `640×360`；`feetY` 在 1–359 之间 |
| `bodyBox` | 是 | 身体占的画布矩形，命中判定和贴边的依据，必须完整落在画布内 |
| `pools` | 是 | 五个必需池 `idle/turn/move/click/drag` 一个都不能少，每池至少一条 |
| `weights` | 否 | 池级权重，只影响自主走动选哪个池；不写等于全 1 |
| `animationMeta` | 否 | 单条动画的 `loop` / `mirrorable` / `bodyBox` 覆盖 |
| `hotspots` | 否 | v2 互动用，v1 只透传 |

池名与动画名只允许 `[a-z][a-z0-9_-]`（池名 ≤32、动画名 ≤40）。它们要当文件名用，
也要拼进 URL，中文和大小写混用在 Windows 上都有坑。

### 三条素材合同

1. **动画周期必须整除素材时长。** 每段动画从标准正面姿势起步、末尾回到这个姿势，
   这样任何一段播完都能无缝接回待机。**不要把首帧复制一份当末帧**，那会多停一帧。
   周期取 1.6 秒这种不整除 4 秒的值是最常见的错法：末帧停在半空，每次接缝就跳一下。
2. **角色任何一帧都不许出 `bodyBox`。** 出框的后果是命中判定错位——鼠标停在
   看得见的身上不弹面板，停在看不见的框里反而弹。原地动作（呼吸、摆尾、跳跃）写在
   动画里；**位移（走路、跑动）不写在动画里**，由程序移动整个舞台实现。
   轮廓剧变的动作（趴下、缩成一团）要在 `animationMeta.<名>.bodyBox` 里单独给框。
3. **编码必须是 VP9 + alpha 的 WebM：**

   ```bash
   ffmpeg -y -i 输入.mov -vf "colorkey=0x0000FF:0.30:0.05,format=yuva420p" \
     -c:v libvpx-vp9 -pix_fmt yuva420p -crf 8 -b:v 0 -auto-alt-ref 0 -row-mt 1 -an 输出.webm
   ```

   不显式写 `-c:v libvpx-vp9` 会**静默丢掉 alpha 通道**——画面看着正常，背景变成
   一整块不透明矩形。`-auto-alt-ref 0` 也不能省。

### 交付前必做

```bash
npm run alpha:check skins/mine/animation/idle/patrol.webm
# 期望：{"frames":8,...,"bgAlphaMax":0,"haze":false}
```

`haze:true` 说明背景没抠干净，或者角色跑出了 `bodyBox`。这个工具分不清这两种，
两种都要排查。调小 `colorkey` 的相似度容差（第二个数，0.30 → 0.20）重导。

---

## 常见故障

| 现象 | 原因与处理 |
|---|---|
| 宠物周围有一块灰色/蓝色矩形底 | 素材 alpha 没做好。跑 `npm run alpha:check`；确认编码命令里有 `-c:v libvpx-vp9` 和 `-pix_fmt yuva420p` |
| 鼠标停在宠物身上没反应 | `Ctrl+Shift+点身体` 看红框和看得见的轮廓对不对得上。对不上就是 `bodyBox` 写小了，或者动画把角色画出了框 |
| 面板弹出来但点不动按钮 | 穿透租约被放开了。看主进程控制台有没有 `[fullscreen]` 或 IPC 报错；确认渲染层心跳还在发（`window.__petDebug.grabSends` 应该持续增长） |
| 整块屏幕点不动 | 兜底机制会在 500 毫秒后自动恢复穿透。如果持续发生，说明渲染层在反复请求接住鼠标，检查悬停判定 |
| 全屏看视频/玩游戏时被宠物盖住 | 让路探测没起来。检查 `powershell.exe` 是否被安全策略拦住，主进程控制台会有 `[fullscreen]` 错误 |
| 换皮肤没生效 | 看控制台有没有「找不到皮肤」警告。用户皮肤要放在 `%APPDATA%\with-me\skins\<id>\`，且 `save.json` 的 `skin` 字段要等于目录名（小写字母数字下划线短横线） |
| 动画接缝处跳一下 | 素材周期没整除时长，见上面第 1 条合同 |
| 启动后什么都没有 | 打开 DevTools 看控制台。皮肤装载失败时屏幕上会出现红色错误框；如果连错误框都没有，检查 `dist/preload/index.cjs` 是否存在 |

---

## 架构与文档

几份文档各司其职，冲突时以功能规格的约束节和验收节为准：

| 文档 | 回答什么 |
|---|---|
| [`docs/桌宠-Windows实现方案.html`](docs/桌宠-Windows实现方案.html) | 为什么这样设计，取舍的理由 |
| [`docs/superpowers/specs/2026-11-02-desktop-pet-v1.md`](docs/superpowers/specs/2026-11-02-desktop-pet-v1.md) | 交付什么、怎么算验收、哪些约束不可协商 |
| [`docs/架构大纲.md`](docs/架构大纲.md) | 系统由哪几块组成、每块用什么技术 |
| [`docs/superpowers/plans/2026-11-02-desktop-pet-v1.md`](docs/superpowers/plans/2026-11-02-desktop-pet-v1.md) | 14 个任务、83 个步骤的施工单 |
| [`docs/实现进度.md`](docs/实现进度.md) | 现在做到哪了（由脚本生成，别手改） |
| [`spike/README.md`](spike/README.md) | 整屏透明窗 + 硬件加速的真机实测数据 |
| [`problem/`](problem/README.md) | 开发中真实踩到的坑：症状、根因、修法、怎么验、教训 |

`docs/` 与 `codex-review/` 按决定不入库（只在本地），所以克隆下来的人看不到上面那几行链接；
`problem/` 和 `spike/` 是入库的。

一句话架构：Electron 双进程 + 一个共享纯逻辑层。主进程只做建窗、穿透开关、光标推进、
焦点切换四件事（全部收在 `Platform` 接口后面），皮肤校验、命中判定、悬停计时、
行为调度、播放器抽象全是不依赖 Electron 和 DOM 的纯函数，所以能被单测覆盖。
素材走自定义协议 `app://`，因为 Chromium 禁止 `file://` 页面 import ES 模块。

## 已验证的关键事实

- 整屏透明覆盖层 + **保留硬件加速**在真机成立：宠物框外 580 万像素不透明数为 0，
  真实屏幕差分意外变化为 0，24fps 不掉帧，CPU 稳态 1.4%。
- **不能用 `<video loop>`**：实测每次循环回到起点都要重新缓冲。重复播放由行为层
  再调一次 `play()` 实现。
- 主进程 ESM 入口不能写顶层 `await`，会与 `app.whenReady()` 互等死锁。
- `ipcMain.on` 必须早于 `loadFile`，否则渲染层首帧消息静默丢失。

详细数据见 `spike/README.md`。

## 许可

代码许可证待定（v1 收尾时决定）。**不搬运任何第三方美术素材**——参考项目的
图与视频一律不用。
