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

// ---- 鼠标与悬停 ----
/** 主进程把系统光标推进给渲染层的间隔。穿透状态下网页收不到 mousemove，只能这样喂。 */
export const CURSOR_POLL_MS = 33
/** 光标停在身体上满这么久才弹面板，避免路过就闪。 */
export const HOVER_DWELL_MS = 400
/**
 * 面板最后一次交互后，光标不在身体也不在面板上满这么久才收起。
 * 比弹出的 400ms 长得多：面板是用来点按钮的，鼠标在按钮之间走位的时间
 * 不该把面板收掉；而收得太快会让用户觉得按钮自己跑了。
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
/** 文字区实测 120×78（下面还有回应按钮那一行），13px 字号一行约 9 字、放得下 3 行；24 字留了余量。 */
export const TALK_MAX_CHARS = 24
/**
 * 气泡底图（Kenney Emotes Pack，CC0），相对渲染层页面解析。
 * 现在是 Pixel Style 5 那枚：16×16 的圆角方块 + 底部中间的尾巴。
 */
export const BUBBLE_IMAGE = 'emotes/bubble.png'
/**
 * 显示尺寸 = 原图 10 倍。**必须整数倍**：像素图放大到 9.5 倍会把格子拉成 uneven 的糊边，
 * 而 style.css 里的 width/height 要和这两个数一致（有测试钉住，照 CLIP_FADE_MS 那条老规矩）。
 */
export const BUBBLE_W = 160
export const BUBBLE_H = 160
/** 原图 16×16 里身子占第 0..12 行，尾巴占 13..15 → 换算到显示尺寸就是身子 130px。 */
export const BUBBLE_BODY_H = 130
/** 气泡与它下面那块（面板或身体）之间的间隙。 */
export const BUBBLE_GAP = 12

/**
 * 面板上的功能按钮，顺序即显示顺序。
 *
 * `pool` 是点下去播哪一类反应；`view` 是切到哪个视图。业务功能（喂食扣饥饿值、
 * 小游戏、状态面板）还没接，带 pool 的三条都指向 click 池，因为它是皮肤契约保证存在的反应池。
 * 图标是 SVG 文件，相对渲染层页面（`app://assets/renderer/index.html`）解析。
 */
export type PanelButton = {
  id: string
  /** 图标读不懂时的兜底：按钮的 title 与 aria-label。 */
  label: string
  icon: string
  pool?: string
  view?: 'settings' | 'foods'
}

export const PANEL_BUTTONS: readonly PanelButton[] = [
  { id: 'feed', label: '喂食', icon: 'icons/rice.svg', view: 'foods' },
  { id: 'game', label: '小游戏', icon: 'icons/activity.svg', pool: 'click' },
  { id: 'status', label: '状态', icon: 'icons/status.svg', pool: 'click' },
  { id: 'settings', label: '设置', icon: 'icons/settings.svg', view: 'settings' },
]

// ---- 喂食列表 ----
/** 一格多大。用户要求「食物图片是正方形」，现在是文字，以后换图片不改尺寸。 */
export const FOOD_CELL = 56
export const FOOD_GAP = 4
/** 一屏可见格数。视口宽 = 4×56 + 3×4 = 236。 */
export const FOOD_VISIBLE = 4
/** 食物表本体在 `shared/food.ts`——那里要带排版宽度函数，config 只放常量。 */

// ---- 存档 ----
export const SAVE_VERSION = 1
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
