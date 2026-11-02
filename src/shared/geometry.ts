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
 * 面板该摆在身体框上方的哪个位置（覆盖层 CSS 坐标）。
 *
 * 优先贴在身体上方；顶边放不下就翻到身体下方；最后整体夹回屏幕内。
 * 夹取是必须的——覆盖层虽然铺满屏幕，面板自己不能溢出到看不见的地方，
 * 否则用户会以为按钮"消失了"。
 */
export function panelAnchor(body: Rect, size: { w: number; h: number }, screen: Rect, gap: number): Point {
  const above = body.y - size.h - gap
  const y0 = above >= screen.y ? above : body.y + body.h + gap
  const x = Math.min(
    Math.max(body.x, screen.x),
    Math.max(screen.x, screen.x + screen.w - size.w),
  )
  const y = Math.min(Math.max(y0, screen.y), Math.max(screen.y, screen.y + screen.h - size.h))
  return { x, y }
}
