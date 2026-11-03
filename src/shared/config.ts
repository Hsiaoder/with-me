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

// ---- 皮肤 ----
export const SKIN_MANIFEST = 'manifest.json'
export const SKIN_ANIMATION_DIR = 'animation'
export const ANIMATION_EXT = '.webm'
/** 缺任何一条就拒绝装载该皮肤。 */
export const REQUIRED_POOLS = ['idle', 'turn', 'move', 'click', 'drag'] as const
/** 缺省按池名决定是否循环：状态性动作要能一直挂着，反应性动作播完就回待机。皮肤契约 3.1。 */
export const LOOPING_POOLS = ['idle', 'turn', 'move'] as const
/** 无人交互时允许自主挑选的池。反应池（click/drag）不在其中——宠物不该没事干抖一下被点的反应。 */
export const AMBIENT_POOLS = ['idle', 'move', 'turn'] as const
/** 面板上的动作按钮，顺序即显示顺序。 */
export const PANEL_POOLS = ['idle', 'move', 'turn', 'click', 'drag'] as const
export const PANEL_LABELS: Record<string, string> = {
  idle: '待机',
  move: '走走',
  turn: '转身',
  click: '回应',
  drag: '抓一把',
}

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
