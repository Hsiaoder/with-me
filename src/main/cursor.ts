import { CURSOR_POLL_MS } from '../shared/config.js'
import type { Point } from '../shared/types.js'

/**
 * 轮询系统光标并推给调用方，位置没变就不发。返回停止函数。
 *
 * 为什么不听 mousemove：穿透状态下这扇窗根本不接收鼠标事件，
 * 事件监听一次都不会触发。两个参考项目都是主进程轮询后推进去。
 */
export function startCursorPolling(getPoint: () => Point, sink: (p: Point) => void): () => void {
  let last: Point | null = null
  const timer = setInterval(() => {
    const p = getPoint()
    if (last !== null && last.x === p.x && last.y === p.y) return
    last = p
    sink(p)
  }, CURSOR_POLL_MS)
  return () => clearInterval(timer)
}
