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
 */
export function panelAnchor(body: Rect, size: { w: number; h: number }, screen: Rect, gap: number): Point {
  const below = body.y + body.h + gap
  const y0 = below + size.h <= screen.y + screen.h ? below : body.y - size.h - gap
  const centered = body.x + body.w / 2 - size.w / 2
  const x = Math.min(
    Math.max(centered, screen.x),
    Math.max(screen.x, screen.x + screen.w - size.w),
  )
  const y = Math.min(Math.max(y0, screen.y), Math.max(screen.y, screen.y + screen.h - size.h))
  return { x, y }
}
