/**
 * 全局唯一的尺寸、时间与命名常量。
 * 设计文档里的每个数字都在这里落地，其他文件只 import，不许再写字面量。
 *
 * 这一文件**刻意不 import 任何东西**：e2e 是直接 `import '../src/shared/config.ts'` 的，
 * Node 的类型剥离只处理被点名的那个文件，不会把里面的 `./x.js` 再指回 `./x.ts`，
 * 所以这里写一条相对 import 就会 `ERR_MODULE_NOT_FOUND`
 * （2026-11-06 一天撞上两次：先是气泡尺寸想从形状清单推导，后是 e2e 想直接 import talk）。
 * 推论：**e2e 直接 import 的 shared 模块必须自己也是零 import 的**
 * （config / food / stats / text / scroll 都是）。
 * 需要从一个清单推导的量，由 `test/config.test.ts` 现算来钉住，不在这里 import；
 * 测试要读跨模块的内容，就从渲染层开一个 debug 读数口（`__petDebug.talkLines` 就是这么来的），
 * 也别在测试里抄一份——抄的那份改台词时不会红。
 */

// ---- 素材合同（皮肤的画布与锚点，改这三个数等于重做所有素材）----
export const CANVAS_W = 640
export const CANVAS_H = 360
/** 脚底基准线（画布纵坐标）。宠物「站在」桌面哪条线由它决定。 */
export const FEET_Y = 330

/** 宠物在屏幕上的显示宽度（CSS 像素）。高度按 16:9 推导，避免两处写死算不一致。 */
export const STAGE_W_CSS = 320
export const STAGE_H_CSS = (STAGE_W_CSS * CANVAS_H) / CANVAS_W

/** 身体在画布里的默认包围盒。皮肤 manifest 的 bodyBox 与此同源，皮肤可覆盖。 */
export const DEFAULT_BODY_BOX = { x: 200, y: 50, w: 240, h: 285 } as const

// ---- 鼠标与面板 ----
/** 主进程把系统光标推进给渲染层的间隔。穿透状态下网页收不到 mousemove，只能这样喂。 */
export const CURSOR_POLL_MS = 33
/**
 * 面板被点出来之后，光标不在身体也不在面板上满这么久才收起。
 * 不能收得太快：面板是用来点按钮的，鼠标在按钮之间走位的那几像素不该把菜单抽走；
 * 但也不能不收——它悬在桌面上会一直占着交互区。
 */
export const PANEL_HIDE_MS = 1500
/**
 * 操作型视图（设置、食物列表）的收起延时。面板 1500ms 无操作就收，这个在动作视图里够用，
 * 但这两块要逐个点、逐个挑，1500ms 不够操作完，半路收掉等于把用户刚看到一半的东西藏起来。
 */
export const VIEW_HIDE_MS = 5000
/** 渲染层超过这么久没续期就强制恢复穿透，防止整块屏幕点不动。 */
export const LEASE_TIMEOUT_MS = 500
/**
 * 渲染层主动接住鼠标时的续期心跳。必须明显小于 LEASE_TIMEOUT_MS：
 * requestGrab 原本只在光标移动时发，手停在面板上不动就会让租约悄悄过期、鼠标被放开。
 */
export const GRAB_HEARTBEAT_MS = 250
/**
 * 按下之后要走够这么多像素才算「拖起来」。小于它松手算「点」。
 * 这条线存在的理由：pointerdown 立刻算拖起，于是点身体走的也是拖拽那条路，
 * click 池（皮肤契约里的必需池）一直没有触发点，而拖拽动画只能在松手后看见。
 */
export const DRAG_START_PX = 4

// ---- 行为 ----
/**
 * 规则层对「这一拍该干什么」没有池倾向的答复：进入自主活动，让随机层按权重抽。
 *
 * 用 `*` 是因为池名正则 `^[a-z][a-z0-9_-]` 不接受它（皮肤契约的命名规则），
 * 所以任何合法皮肤都不会把这个哨兵当成真的池名。
 */
export const AMBIENT_POOL = '*'
/** 连续无人交互满这么久，规则层交出决策权，由权重在 idle/move/turn 里自主挑。 */
export const IDLE_LONG_MS = 20000
/** 自主走动的速度（CSS 像素/秒）。 */
export const WALK_SPEED_PX_PER_SEC = 40
/** 舞台宽相对画布宽的缩放，位移与脚底对齐都要用它。 */
export const STAGE_SCALE = STAGE_W_CSS / CANVAS_W

// ---- 播放 ----
/**
 * 换片时旧层淡出的时长。必须和 `style.css` 里 `.pet-video.is-out` 的 transition 一致，
 * 不然收尾定时器会把还在淡的层提前摘掉（露出半成品）。
 */
export const CLIP_FADE_MS = 180

// ---- 皮肤 ----
export const SKIN_MANIFEST = 'manifest.json'
export const SKIN_ANIMATION_DIR = 'animation'
export const ANIMATION_EXT = '.webm'
/** 缺任何一条就拒绝装载该皮肤。 */
export const REQUIRED_POOLS = ['idle', 'turn', 'move', 'click', 'drag'] as const
/** 缺省按池名决定是否循环：状态性动作要能一直挂着，反应性动作播完就回待机。皮肤契约 3.1。 */
export const LOOPING_POOLS = ['idle', 'turn', 'move'] as const
/**
 * 无人交互时允许自主挑选的池。反应池（click/drag）不在其中——宠物不该没事干抖一下被点的反应。
 *
 * `move` 也暂时不在其中：平行走动会让宠物整段离开原位、还容易贴着屏幕边站着，
 * 现在这版形象更适合待在原地做小动作。走动那套素材与 `move` 池照旧是契约的一部分，
 * 想放回来只要把名字加回这个数组。
 */
export const AMBIENT_POOLS = ['idle', 'turn'] as const

/**
 * 状态栏「状态」那一行的人话：池名 → 此刻在干什么。
 *
 * 这行读的是**当前动画池**，不是编出来的成长值——我们没有「经验自动涨」那套系统，
 * 写「正在成长」就是假数据（用户给的参考图是 QQ 宠那种自动成长系统，口径不同）。
 * 每个池都得有条：漏一个就落到 ACTIVITY_FALLBACK，而「正在发呆」出现在吃饭时就是 bug。
 */
export const ACTIVITY_LABELS: Record<string, string> = {
  idle: '正在休息',
  turn: '正在张望',
  move: '正在散步',
  click: '正在打招呼',
  drag: '被拎着',
  eat: '正在吃饭',
  guess: '在做动作',
}
/** 皮肤里有自定义池（比如 sleep）时的兜底。 */
export const ACTIVITY_FALLBACK = '正在发呆'

/**
 * 状态栏刷「在线时间」的节拍。
 *
 * 挂在定时器上而不是 rAF：这扇窗 `focusable:false`，没有焦点时 rAF 会被节流，
 * 数字就跟着抖（心跳那条踩过同一个坑，见 renderer/index.ts 的 sendGrab）。
 * 1 秒是「分秒」那档的最小粒度，再快也没有可读的变化。
 */
export const ONLINE_TICK_MS = 1000

// ---- 说话 ----
/** 气泡默认停留时长。光标还在气泡上会续命，见渲染层装配。 */
export const BUBBLE_SHOW_MS = 5000
/** 语音真播完（`ended`）之后，气泡再多停这么一会儿，让主人读完最后一句再收。 */
export const VOICE_BUBBLE_PAD_MS = 1000
/** 退出收尾等再见语音的最长时间：autoplay 被拒 / 素材坏 / 中途静音时，语音这一路最多等这么久，
 *  不等满退出的总兜底（见 index 的 10 秒）。 */
export const EXIT_VOICE_MAX_MS = 6000
/** 事件台词（喂食/逗玩/状态/跨级…）之间的最小间隔：只防同一秒两句叠着冒，不压正常回应。 */
export const TALK_COOLDOWN_MS = 8000
/**
 * 自己搭话（idle/hungry/blue/comfort）之间的最小间隔，把「说话」和「被叫就应」分成了两条账。
 *
 * 对照 qqpet：它的待机计时器每次 20–60 秒（每个动作演完重新上弦），每拍只有约 1/3 的机会真开口
 * （走路、玩耍各占一拍，都算这一拍用掉了），换算下来平均 1.5–2 分钟才一句。
 * 我们原来是「闲 20 秒 + 每个待机片段 35% + 25 秒冷却」，平均 30–40 秒一句。
 * 用户 2026-11-13 报「说话太快」，这里按 qqpet 的均值调到 100 秒，概率降到 30%。
 */
export const TALK_IDLE_GAP_MS = 100000
/** 「闲到交出决策权」那一拍里开口的概率。事件驱动的台词不受它约束。 */
export const TALK_IDLE_PROB = 0.3
/** 台词迁移后最长 40 字；气泡靠缩字号容纳长句、不压缩原话，上限放宽到 50 留余量（见 style.css 气泡正文）。 */
export const TALK_MAX_CHARS = 50
/**
 * 气泡底图，相对渲染层页面解析。**矢量**（`src/renderer/emotes/bubble.svg`），形状是**云朵**：
 * 一块圆角身子 + 顶上三朵云包 + 底下三颗渐小的云团当尾巴（尾巴指着宠物，这条从上一版保留）。
 *
 * 素材是**生成物**：形状合同只有 `src/shared/bubble-shape.ts` 那一份图元清单，
 * 跑 `node tools/make-bubble-svg.mjs` 出 SVG，`BUBBLE_H`/`BUBBLE_RING_W` 也从同一份算出来。
 * 上一版是手写 `<path>` + 注释里三个数 + 测试再读两个数——形状一改就得手工重算三处，
 * 而测试只能核对 viewBox 与 stroke-width，中间那段是「信我算对了」，不是验出来的。
 *
 * 环的做法也换了：不描边，而是**先画外扩 12 单位的彩色并集、再盖一层原始白色并集**。
 * 膨胀（Minkowski 和一个小圆）对并集可分配，圆角矩形又正好是「矩形膨胀 r」，
 * 所以每个图元各自加 r 再并起来 = 整个形状外扩 r：**环厚处处一致，交界处不会多出横线**
 * （分两条路径画「身子 + 尾巴」时被那道封口横线咬过，见 problem/03 §3.8）。
 * 再往前四版：SVG Repo 那颗正圆 + 尖（环厚 9.2px；用户说边框还是太宽，而且圆腔里塞矩形
 * 文字块总是浪费一圈）、iconfont 的聊天气泡（尾巴歪左下、下沿是平的）、肥皂泡（没尾巴，
 * 所以不指宠物）、Kenney 空气泡位图（CC0，削描边 + 删中段得到 32×32，CSS 放大 5 倍后
 * **描边被二次采样摊开**——内半侧约 4.5 CSS px 一路淡到白，`spike/bubble-edge-ab.mjs` 量的，
 * 2× 远程桌面上就是「边缘很模糊」，那才是换矢量的原因）。换矢量没有「整数倍才不糊」这条约束。
 */
export const BUBBLE_IMAGE = 'emotes/bubble.svg'
/**
 * 显示宽度。**只有这一个旋钮**：高与环厚都按清单的比例推出来，改它等于整只气泡等比缩放。
 * 208 是量出来的——画布就是含环的墨迹包围盒（416×376 单位），框里不留空白，
 * 因为 `bubbleAnchor` 拿这个框和宠物保持 `BUBBLE_GAP`，框里空一圈就等于间隙白多出一圈。
 */
export const BUBBLE_W = 208
/** 画布高 376 × 同一个比例（0.5）。清单改了这里没跟着改，`test/config.test.ts` 会现算一遍发现对不上。 */
export const BUBBLE_H = 188
/** 环（那圈蓝）的显示粗细 = 清单里的 ring 12 单位 × 0.5。同上，测试负责核对。 */
export const BUBBLE_RING_W = 6
/**
 * 文字与回应按钮的下界。内容块「宽 150、高 86」（文字 60 + 缝 4 + 按钮 22）落在
 * CSS x 29..179、y 57..**143**；四角与四条边的中点都要在白色内腔里再缩 12 单位（6 CSS px）
 * ——只看四角不够，云包之间的凹缝正好能从边的中段咬进来一口。
 * 这条由 `test/config.test.ts` 用 `fitsInsideCloud` 现算，不抄数；历史 120（空气泡按行号量）
 * → 180（肥皂泡椭圆）→ 152 / 134（正圆）→ 106（圆角矩形）→ 143（云朵）。形状一换就得重算。
 */
export const BUBBLE_INNER_BOTTOM = 143
/** 气泡与它下面那块（面板或身体）之间的间隙。 */
export const BUBBLE_GAP = 12
/** 气泡文字框宽（与 style.css .pet-bubble-text 的 width 一致）。 */
export const BUBBLE_TEXT_WIDTH = 150
/** 默认每行字数（150px / 14px 默认字号 ≈ 10）。台词表按它剔除超 3 行的句子；气泡渲染按当前字号实时算。 */
export const BUBBLE_CHARS_PER_LINE = 10

/**
 * 属性变化时飘出来的那串小数字（「饥饿 +12」）。
 * 尺寸是**锚点算得着的量**，所以和气泡那条 BUBBLE_W/H 一样走 config：
 * `floatAnchor` 要拿它决定站左边还是右边，`test/config.test.ts` 钉 CSS 与它是同一个数。
 * 宽 84 是按墨迹实测定下来的（`spike/float-width.mjs` 在真窗口里量）：最长的一条能出现的
 * 标签「亲密度 +99.9」墨迹 74px，连不可能出现的「亲密度 +100.0」也才 82px。
 * 芯片是 `overflow:hidden`，装不下就是**悄悄裁掉**，所以 e2e 里塞一条最宽的进去量。
 */
export const FLOAT_CHIP = { w: 84, h: 22 }
/** 飘字与身体之间的水平间隙。 */
export const FLOAT_GAP = 8
/** 飘字顶端离身体顶沿多远：20 是量出来的——气泡底沿在身体顶再往上 12，
 *  飘字从这里上升 20px 刚好一路待在气泡下沿之外，两者不会叠。 */
export const FLOAT_HEAD_OFFSET = 20
/** 一条飘字活多久。CSS 的上浮淡出也是这个时长（有测试钉住），定时器负责清理，
 *  所以「系统减少动效」把动画关掉时数字照样会消失，不会堆在那儿。 */
export const FLOAT_MS = 1100

/**
 * 面板上的功能按钮，顺序即显示顺序。
 *
 * `pool` 是点下去播哪一类反应；`view` 是切到哪个视图。喂食与状态已经接上真功能
 * （一个出列表并扣饥饿，一个出数值状态栏），小游戏与状态按钮仍指向 click 池，
 * 因为它是皮肤契约保证存在的反应池。图标相对渲染层页面（`app://assets/renderer/index.html`）解析。
 */
export type PanelButton = {
  id: string
  /** 图标读不懂时的兜底：按钮的 title 与 aria-label。 */
  label: string
  icon: string
  pool?: string
  view?: 'foods' | 'stats' | 'games' | 'debug'
}

export const PANEL_BUTTONS: readonly PanelButton[] = [
  { id: 'feed', label: '喂食', icon: 'icons/rice.svg', view: 'foods' },
  { id: 'game', label: '小游戏', icon: 'icons/game.svg', view: 'games' },
  { id: 'status', label: '状态', icon: 'icons/heart.svg', view: 'stats' },
  // 调试台：条件触发 / 动画全集 / 台词全表 / 游戏食物 + 等级与数值滑条。测试用，替换旧的「说话」按钮。
  { id: 'debug', label: '调试', icon: 'icons/debug.svg', view: 'debug' },
]

// ---- 喂食列表 ----
/** 一格多大。用户要求「食物图片是正方形」，现在是文字，以后换图片不改尺寸。
 *  48 而不是 56：格子是比圆底（40）还大 40% 时，同一竖列里「能点的东西」出现两种量级，
 *  而且把底板撑到比按钮排宽 82px（两端各空 41px，谁也不对齐谁）。收到 48 后伸出量 25px。 */
export const FOOD_CELL = 48
/**
 * 格子里那张图的边长。48 的格子减左右各 1px 描边还剩 46，给 40 是留 3px 呼吸——
 * 顶到边会让六个东西看起来大小不一（PNG 自己已经带了一圈内边距，见 tools/make-food-icons.mjs 的 FILL）。
 * CSS 里那个 40px 由 test/config.test.ts 反查钉住，改这里要连着改 CSS。
 */
export const FOOD_ICON = 40
export const FOOD_GAP = 4
/** 一屏可见格数。视口宽 = 4×48 + 3×4 = 204。 */
export const FOOD_VISIBLE = 4
/** 食物表本体在 `shared/food.ts`——那里要带排版宽度函数，config 只放常量。 */

// ---- 游戏列表 ----
/** 和食物列表同一套格子量级（48 方卡 / 40 图 / 4 间距），UI 才长得一样。表本体在 `shared/games.ts`。 */
export const GAME_CELL = 48
export const GAME_ICON = 40
export const GAME_GAP = 4

// ---- 存档 ----
/**
 * v2：加了 identity（名字/性别）与养成数值四条。v1 的 stats 是占位形状
 * （{hunger,mind,clean,mood} 全 80，且没有任何生产调用方改过它），迁移时 hunger/mood 沿用、
 * mind/clean 丢弃，见 shared/save.ts 的 migrate。
 */
export const SAVE_VERSION = 3
export const SAVE_FILE = 'save.json'

// ---- 应用身份 ----
/**
 * Windows 的 AppUserModelID。必须与 electron-builder.yml 的 appId 一致（test/media.test.ts 钉住）。
 *
 * 不只影响任务栏分组：Chromium 把页面里的 <audio> 登记成系统媒体会话（SMTC）时，
 * 用的就是这个 AUMID。媒体探测器要靠它对上号、把自己排掉——否则宠物说一句话，
 * 自己就会被当成「有音乐在放」，正在播的台词语音当场掐掉。
 */
export const APP_AUMID = 'com.hsiaoder.with-me'

// ---- 窗口 ----
/** 覆盖层的自定义协议前缀。Chromium 禁止 file:// 页面 import ES 模块，素材也必须同源。 */
export const APP_SCHEME = 'app'
/**
 * 资源根用「主机名」区分，不用路径首段：standard 协议下 Chromium 会把路径首段
 * 搬进主机位，`app:///renderer/index.html` 到处理器里已经变成 `app://renderer/index.html`，
 * 按首段找根永远找不到（实测 403）。
 */
export const APP_HOST = 'assets'
export const SKIN_HOST = 'skin'
/** 页面与模块都从 assets 根走，相对 import 才能留在同一个主机下。 */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}/`
/** 素材地址由 JS 拼绝对 URL，不走相对解析。 */
export const SKIN_ORIGIN = `${APP_SCHEME}://${SKIN_HOST}/`
/**
 * 面板与身体框之间的间距；按钮条用它贴脚底，状态栏用它贴身子右侧。
 * 2026-11-06 16 → 10（用户「按钮离身体有点远了」）。两处共用一个数是故意的：
 * 这条量的都是「贴着看得见的身子留多少空气」，空气该一样多。
 */
export const PANEL_GAP = 10
/** 按钮条与副板（食物列表）之间的间距。比 PANEL_GAP 小：这两块是一组，不该看着像两个东西。 */
export const PLATE_GAP = 6
