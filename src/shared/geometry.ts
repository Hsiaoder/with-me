import { CANVAS_H, CANVAS_W, STAGE_H_CSS, STAGE_W_CSS } from './config.js'
import type { Box, Point, Rect } from './types.js'

/**
 * 画布坐标 → 覆盖层坐标。皮肤给的是 640×360 画布里的框，屏幕上宠物只有
 * `STAGE_W_CSS` 宽，中间这一层换算加多区命中，是后续所有点击行为的底座。
 *
 * 全层纯函数：不读 DOM、不碰 Electron，所以每个数字含义都能被单测钉住。
 */

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/** 宠物舞台（视频画框）在覆盖层中的矩形。 */
export function stageRect(petPos: Point): Rect {
  return { x: petPos.x, y: petPos.y, w: STAGE_W_CSS, h: STAGE_H_CSS }
}

/**
 * 身体矩形：画布坐标 → 覆盖层坐标。
 *
 * @param manifest 只用到 bodyBox，所以不要求传整份 SkinManifest
 * @param petPos 舞台左上角
 * @param override 当前动画自己的覆盖框（趴下、躲藏这类轮廓剧变的动作）。
 *   不传就用皮肤默认框；`exactOptionalPropertyTypes` 下别显式传 undefined，调用方自己判。
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

/** 命中判定：身体 ∪ 面板，任一框含住该点即为真。空集合为假。 */
export function anyContains(rects: Rect[], p: Point): boolean {
  return rects.some((r) => rectContains(r, p))
}

/**
 * 外接矩形。`null` 表示那块现在不在布局里（面板收起 / 气泡没开），直接忽略。
 *
 * 交互区就靠它把「身体 — 空隙 — 面板 — 气泡」连成一块：各按自己的矩形判命中时，
 * 中间那截空隙会闪回桌面的光标，因为并集本身是不连通的。
 */
export function unionRect(a: Rect, ...rest: (Rect | null)[]): Rect {
  let r = a
  for (const b of rest) {
    if (!b) continue
    const x = Math.min(r.x, b.x)
    const y = Math.min(r.y, b.y)
    r = { x, y, w: Math.max(r.x + r.w, b.x + b.w) - x, h: Math.max(r.y + r.h, b.y + b.h) - y }
  }
  return r
}

/**
 * 气泡该摆在哪。**永远在宠物上方**——尾巴朝下指着宠物头，翻到下面去尾巴就指反了。
 *
 * 头顶放不下时**允许 y 为负**：覆盖层只盖住工作区，窗口外的部分天然被裁掉，
 * 把宠物拖下来气泡就重新出现。以前夹到屏幕顶，结果是宠物贴顶时气泡整个压回头上——
 * 「不越界」看着安全，实际是把气泡推到它最不该去的地方。
 *
 * 面板在头顶时（宠物站在地面上必然如此），气泡接在**面板**外侧，串序是
 * 屏幕顶 … 气泡 → 面板 → 宠物 → 地面；面板在脚下时不掺和，直接接身体上方。
 */
export function bubbleAnchor(
  body: Rect,
  panel: Rect | null,
  size: { w: number; h: number },
  screen: Rect,
  gap: number,
): Point {
  const above = panel !== null && panel.y + panel.h <= body.y
  const edge = above ? (panel as Rect).y : body.y
  const centered = body.x + body.w / 2 - size.w / 2
  const x = Math.min(Math.max(centered, screen.x), Math.max(screen.x, screen.x + screen.w - size.w))
  return { x, y: edge - gap - size.h }
}

/** 主块落在了宠物的哪一侧。副板要靠它决定自己往哪边长——见 stackAnchor。 */
export type StackSide = 'below' | 'above'

export interface Anchored {
  x: number
  y: number
  side: StackSide
}

/**
 * 按钮面板该摆在宠物身边的哪个位置（覆盖层 CSS 坐标）。
 *
 * **脚底下优先**——一排按钮跟着脚走，视觉上是从宠物身上「递出来」的，
 * 这也是 QQ 宠那一系桌宠的做法；脚下放不下（宠物站在地上时必然放不下）
 * 才翻到头顶。最后整体夹回屏幕内：覆盖层虽然铺满屏幕，面板自己不能溢出到
 * 看不见的地方，否则用户会以为按钮"消失了"。
 *
 * 横向**以身体的对称轴为轴居中**，不是贴着身体左沿：画布左右各有大片空白，
 * 贴左沿会让整排图标明显偏向角色的一侧。
 *
 * 除了坐标还要报出落在哪一侧：食物列表是挂在按钮条下面的第二块，
 * 按钮条翻到头顶时它必须跟着翻到按钮条**上面**，否则就压在宠物身上。
 */
export function panelAnchor(body: Rect, size: { w: number; h: number }, screen: Rect, gap: number): Anchored {
  const below = body.y + body.h + gap
  const fitsBelow = below + size.h <= screen.y + screen.h
  const y0 = fitsBelow ? below : body.y - size.h - gap
  const centered = body.x + body.w / 2 - size.w / 2
  const x = Math.min(
    Math.max(centered, screen.x),
    Math.max(screen.x, screen.x + screen.w - size.w),
  )
  const y = Math.min(Math.max(y0, screen.y), Math.max(screen.y, screen.y + screen.h - size.h))
  return { x, y, side: fitsBelow ? 'below' : 'above' }
}

/**
 * 副板（食物列表）该挂在主块（按钮条）的哪一边。
 *
 * 规则只有一条：**永远背对宠物**。主块在脚下时副板往下长，主块翻到头顶时副板往上长，
 * 中间那段留给宠物本体。横向跟主块中线，然后夹回屏幕内——副板比按钮条宽得多，
 * 宠物贴左右边缘时不夹就会溢出到看不见的地方。
 */
export function stackAnchor(
  primary: Rect,
  size: { w: number; h: number },
  screen: Rect,
  gap: number,
  side: StackSide,
): Point {
  const y0 = side === 'below' ? primary.y + primary.h + gap : primary.y - gap - size.h
  const centered = primary.x + primary.w / 2 - size.w / 2
  const x = Math.min(
    Math.max(centered, screen.x),
    Math.max(screen.x, screen.x + screen.w - size.w),
  )
  const y = Math.min(Math.max(y0, screen.y), Math.max(screen.y, screen.y + screen.h - size.h))
  return { x, y }
}

/**
 * 状态栏该摆在宠物哪一侧（覆盖层 CSS 坐标）。
 *
 * **右侧优先**：按钮面板占着脚下那一横条，状态栏再去那儿就会和面板叠住；
 * 而纵向读数天然是竖的一条，挂右边既不压宠物也不压按钮。
 * 右边放不下（宠物贴右边缘）才翻到左边——**不是夹进屏幕**：夹过来会压在宠物身上，
 * 那正是气泡那条踩过的坑（见 problem/05 §5.10）。两边都不行才夹回屏幕内。
 *
 * 纵向：先和身体中线对齐，再往上抬 `lift`，最后夹回屏幕内。
 * 为什么要 `lift` 这个数而不是继续居中：这张卡比身体高（实测 182 vs 165），
 * 居中就必然从身体底沿再往下挂 8px 多，而那正是按钮条的地盘。往上抬 12 之后
 * 底沿离按钮条 13px、顶沿离气泡底边 14px，两头都空出来——气泡底边拉直（不再鼓云包）
 * 才腾得出这 14px，两件事是一起算的。
 */
export function statsAnchor(
  body: Rect,
  size: { w: number; h: number },
  screen: Rect,
  gap: number,
  lift = 0,
): Point {
  const right = body.x + body.w + gap
  const left = body.x - gap - size.w
  const x0 = right + size.w <= screen.x + screen.w ? right : left
  const x = Math.min(Math.max(x0, screen.x), Math.max(screen.x, screen.x + screen.w - size.w))
  const centered = body.y + body.h / 2 - size.h / 2 - lift
  const y = Math.min(Math.max(centered, screen.y), Math.max(screen.y, screen.y + screen.h - size.h))
  return { x, y }
}

/**
 * 把命中框按墨迹内缩收成「看得见的身子」那一条：**只动左右，上下不碰**。
 *
 * 为什么不连 y 一起动：`FLOAT_HEAD_OFFSET` 当初是按命中框顶沿量出来的（气泡底沿在身体顶
 * 再往上 12，飘字从那里上升 20px 一路待在气泡之外）。换成墨迹顶沿去读那个数，
 * 等于把气泡那条账一起挪了——而这次要修的只是横向的距离。
 */
export function inkRect(body: Rect, inset: { left: number; right: number }): Rect {
  const left = body.x + inset.left
  const right = body.x + body.w - inset.right
  return { x: left, y: body.y, w: Math.max(0, right - left), h: body.h }
}

/**
 * 飘字（「饥饿 +12」）该摆在宠物哪一边。
 *
 * **左边优先**：状态栏天然挂右边，飘字再去右边就会跟它挤同一列；
 * 而气泡在头顶、按钮条在脚下，头的左边常年是空的。
 * 三种情况翻到右边：① 状态栏已经占了左边（宠物贴右边缘时它会翻过去）；
 * ② 左边放不下（宠物贴左边缘）而右边放得下；③ 两边都放不下时夹回屏幕内——
 * 夹进来会压在宠物身上，那是气泡和状态栏都踩过的坑（problem/05 §5.10），
 * 但飘字只活一秒，压一下比整条数字跑到屏幕外好。
 *
 * 纵向取 `body.y + headOffset`：**由上往下排**，新的一条接在下面。
 * 这样列的高度变化不会把已经飘起来的字顶来顶去，也保证它一路待在气泡下沿之外。
 */
export function floatAnchor(
  body: Rect,
  plate: Rect | null,
  size: { w: number; h: number },
  screen: Rect,
  gap: number,
  headOffset: number,
): Point {
  const plateOnLeft = plate !== null && plate.x + plate.w <= body.x
  const leftRoom = body.x - gap - size.w >= screen.x
  const rightRoom = body.x + body.w + gap + size.w <= screen.x + screen.w
  const goRight = plateOnLeft || (!leftRoom && rightRoom)
  const x0 = goRight ? body.x + body.w + gap : body.x - gap - size.w
  const x = Math.min(Math.max(x0, screen.x), Math.max(screen.x, screen.x + screen.w - size.w))
  return { x, y: body.y + headOffset }
}
