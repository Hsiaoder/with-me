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
 * 形状是**聊天气泡**——正圆环 + 正下方一个尖（尾巴），内腔填实心白。
 * 轮廓照用户给的 `E:\ai-pet\svg\chat-speech-bubble-svgrepo-com.svg`（SVG Repo 导出）量出来**重画**，
 * 路径没搬——SVG Repo 的授权页这会儿抓不下来（429），商用条款没核到原文，
 * 所以按最稳的做法走：只借形状与比例，不把它的字节进仓库（量的过程见 problem/03 §3.8）。
 * 环厚用原图自己的比例 21.33/512 → 220px 上约 **9.2 CSS px**；上一版（iconfont 那支）是
 * 85.33/1024 → 18.3px，用户点名「边框要设置的细一点」，这版细了一半。
 * 再往前三版：iconfont 的聊天气泡（尾巴歪在左下、下沿是平的）、肥皂泡（没尾巴，所以不指宠物）、
 * Kenney 空气泡位图（CC0，削描边、删中段得到 32×32，放大 5 倍后**描边被二次采样摊开**，
 * 内半侧约 4.5 CSS px 淡到白，`spike/bubble-edge-ab.mjs` 量的——2× 远程桌面上就是「边缘很模糊」，
 * 那才是换矢量的原因）。换矢量没有「整数倍才不糊」这条约束。
 */
export const BUBBLE_IMAGE = 'emotes/bubble.svg'
/**
 * 显示尺寸。主泡是**正圆**，但圆心**不在框正中**：viewBox 512 里圆心 (256, 213.33)，
 * 正下方那截尾巴占掉 213.33..512 那一竖条，尾巴尖正好切在框底。
 * 于是 220 的方框里内腔圆心在 (110, 91.67)、半径 82.5，尾巴尖落在 (110, 220)。
 * 220 不是随手挑的：文字 3 行（60px）+ 回应按钮 22px 这一整块（110×84）要落在内腔圆里，
 * 160 的框只能容 80×55，装不下 24 字。解法与角点校验见 emotes/bubble.svg 与 style.css 的注释。
 * style.css 里的 width/height 要和这两个数一致（有测试钉住，照 CLIP_FADE_MS 那条老规矩）。
 */
export const BUBBLE_W = 220
export const BUBBLE_H = 220
/**
 * 文字与回应按钮的下界。**从圆解出来的**：内容块取「半宽 55、半高 42」，
 * 四角到内腔圆心 (110, 91.67) 最远 69.4，内腔半径 82.5 → 留 13.1 的余量，
 * 于是底边 = 91.67 + 42 ≈ **134**。上一版（iconfont 那颗，圆心就在框正中）是 152，
 * 再上一版（肥皂泡，圆心偏到 137.5）是 180——形状一换这个数就得重算，别只改数字。
 * `test/config.test.ts` 不抄这些数：它从 bubble.svg 里读中线半径、stroke-width 与路径起点，
 * 自己算圆心与内腔半径，再逐个验角点。
 */
export const BUBBLE_INNER_BOTTOM = 134
/** 气泡与它下面那块（面板或身体）之间的间隙。 */
export const BUBBLE_GAP = 12

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
