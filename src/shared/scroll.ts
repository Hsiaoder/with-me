/**
 * 食物列表的滚动数学。全是纯函数——渲染层只留一个状态数 `scrollX`，
 * 「能滚多少、滑块该多宽、翻一屏走多远」都在这里算，这样边界情况能单测而不是靠手拖。
 */

export const maxScroll = (content: number, viewport: number): number => Math.max(0, content - viewport)

export function clampScroll(x: number, content: number, viewport: number): number {
  // NaN/Infinity 一旦漏进来就会一路传染到 transform，列表直接空白。退回 0 最省事。
  if (!Number.isFinite(x)) return 0
  return Math.min(maxScroll(content, viewport), Math.max(0, x))
}

/**
 * 「翻一屏」走多远：可见格数 ×（格子 + 间距）。
 * 带上一个尾间距而不是只算格子宽，是为了步进后下一屏的第一格紧挨着上一屏，不留半格。
 */
export function pageStep(visible: number, cell: number, gap: number): number {
  return visible * (cell + gap)
}

export type Thumb = { x: number; w: number }

export function thumbGeometry(scrollX: number, content: number, viewport: number): Thumb | null {
  if (content <= viewport) return null
  const w = Math.max(8, viewport * (viewport / content))   // 内容再多也不给一根点不到的滑块
  const track = viewport - w
  return { x: track * (clampScroll(scrollX, content, viewport) / maxScroll(content, viewport)), w }
}
