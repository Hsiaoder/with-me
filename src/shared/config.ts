/**
 * 全局唯一的尺寸、时间与命名常量。
 * 设计文档里的每个数字都在这里落地，其他文件只 import，不许再写字面量。
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

// ---- 说话 ----
/** 气泡默认停留时长。光标还在气泡上会续命，见渲染层装配。 */
export const BUBBLE_SHOW_MS = 5000
/** 距上次说话不足这么久就不再插一句，六个 reason 都受它约束。 */
export const TALK_COOLDOWN_MS = 25000
/** 「闲到交出决策权」那一拍里开口的概率。事件驱动的台词不受它约束。 */
export const TALK_IDLE_PROB = 0.35
/** 文字区实测 120×74（下面还有回应按钮那一行），13px 字号一行约 9 字、放得下 3 行；24 字留了余量。 */
export const TALK_MAX_CHARS = 24
/**
 * 气泡底图，相对渲染层页面解析。**矢量**（`src/renderer/emotes/bubble.svg`）：
 * 形状是**圆角矩形 + 底部居中的三角尾巴**，内腔填实心白。
 * 尾巴尖正好落在框底附近，而气泡整体浮在宠物头顶 → 它指着宠物。
 * 再往前四版：SVG Repo 那颗正圆 + 尖（环厚 9.2px；用户说边框还是太宽，而且圆腔里塞矩形
 * 文字块总是浪费一圈）、iconfont 的聊天气泡（尾巴歪左下、下沿是平的）、肥皂泡（没尾巴，
 * 所以不指宠物）、Kenney 空气泡位图（CC0，削描边 + 删中段得到 32×32，CSS 放大 5 倍后
 * **描边被二次采样摊开**——内半侧约 4.5 CSS px 一路淡到白，`spike/bubble-edge-ab.mjs` 量的，
 * 2× 远程桌面上就是「边缘很模糊」，那才是换矢量的原因）。换矢量没有「整数倍才不糊」这条约束。
 * 量的办法见 problem/03 §3.8（`spike/bubble-shape.mjs` 逐行问 isPointInFill / isPointInStroke）。
 */
export const BUBBLE_IMAGE = 'emotes/bubble.svg'
/**
 * 显示尺寸。这版是**矩形**，所以框不再是正方形：viewBox 440×320 → 显示 **220×160**。
 * 环是描边画的，粗细就是素材里 `stroke-width` 那一个数：12 单位 → 220 上 **6 CSS px**
 * （历史 18.3 → 9.2 → 6；再往下别低于 4px，2× 远程桌面上会开始发虚）。
 * 内腔 = 中线内缩半个环 → CSS x 6..214、y 6..120。
 * 220 宽不是随手挑的：正文上限 24 字要排得下，160 的框只能容 80×55。
 * style.css 里的 width/height 要和这两个数一致（有测试钉住，照 CLIP_FADE_MS 那条老规矩）。
 */
export const BUBBLE_W = 220
export const BUBBLE_H = 160
/**
 * 文字与回应按钮的下界。**从内腔矩形解出来的**：内容块「宽 150、高 84」（文字 60 + 缝 4 +
 * 按钮 22）在内腔 y 6..120 里居中 → 顶 20、底 **106**；四角离内腔边还有 14 CSS px，
 * 圆角那段（半径 18，角区只到 x=24 / y=24）也够不着。
 * 历史：120（空气泡按行号量）→ 180（肥皂泡椭圆）→ 152（正圆、圆心在框正中）→
 * 134（正圆、圆心被尾巴顶到 91.67）→ 106（矩形）。形状一换就得重算，别只改数字。
 * `test/config.test.ts` 不抄这些数：它从 bubble.svg 里读中线的矩形界、圆角半径与 stroke-width，
 * 自己算内腔，再验内容块四角。
 */
export const BUBBLE_INNER_BOTTOM = 106
/**
 * 内腔（能写字的那块白）在**显示坐标**里的界与圆角。算法一步到位：
 * 素材画的是环的**中线**矩形 x 6..434、y 6..246、圆角 36，单位是 viewBox 的 440；
 * 显示宽 220 → 比例 0.5；环厚 = stroke-width 12 → 单边吃掉 6 单位；
 * 于是内腔 = 中线往里缩 6 再乘 0.5 = **x 6..214、y 6..120、圆角 15**。
 * `test/config.test.ts` 用它验内容块四角，另外钉住「素材的 viewBox 比例必须等于 BUBBLE_W/H」——
 * 形状换了而这里没跟着重算，那条会红。
 */
export const BUBBLE_CAVITY = { x: 6, y: 6, w: 208, h: 114, r: 15 }
/** 环（那圈蓝）的显示粗细。素材里只有一个 stroke-width 跟它对应，测试把两边钉在一起。 */
export const BUBBLE_RING_W = 6
/** 气泡与它下面那块（面板或身体）之间的间隙。 */
export const BUBBLE_GAP = 12

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
  view?: 'settings' | 'foods' | 'stats'
}

export const PANEL_BUTTONS: readonly PanelButton[] = [
  { id: 'feed', label: '喂食', icon: 'icons/rice.svg', view: 'foods' },
  { id: 'game', label: '小游戏', icon: 'icons/game.svg', pool: 'click' },
  { id: 'status', label: '状态', icon: 'icons/heart.svg', view: 'stats' },
  { id: 'settings', label: '设置', icon: 'icons/settings.svg', view: 'settings' },
  // 调试气泡用：点一次按顺序放一条台词（含那颗回应按钮），绕开冷却与概率。
  { id: 'talk', label: '说话', icon: 'emotes/dots3.png', pool: 'click' },
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

// ---- 存档 ----
/**
 * v2：加了 identity（名字/性别）与养成数值四条。v1 的 stats 是占位形状
 * （{hunger,mind,clean,mood} 全 80，且没有任何生产调用方改过它），迁移时 hunger/mood 沿用、
 * mind/clean 丢弃，见 shared/save.ts 的 migrate。
 */
export const SAVE_VERSION = 2
export const SAVE_FILE = 'save.json'

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
/** 面板与身体框之间的间距；脚底下放不下时同一个间距翻到头顶。 */
export const PANEL_GAP = 16
/** 按钮条与副板（食物列表）之间的间距。比 PANEL_GAP 小：这两块是一组，不该看着像两个东西。 */
export const PLATE_GAP = 6
