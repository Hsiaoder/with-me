import { PANEL_HIDE_MS } from './config.js'
import type { Point } from './types.js'

/**
 * 面板的**收起**计时。
 *
 * 它只管收，不管开：面板由点击叫出来（见 renderer/index.ts 的 openPanel），
 * 以前那半边「停留 400ms 自动弹出」在 2026-11-04 去掉了——鼠标路过就出菜单，
 * 在整屏覆盖层上比在普通窗口里更烦人，而且它和「点一下才动手」这个习惯本来就不一致。
 *
 * 为什么要延时收：用户从宠物身上把光标挪去按钮，中间那截空隙不该把菜单抽走。
 * 面板自己也算「还在宠物旁边」。
 *
 * 纯函数：时钟由调用方注入，测试里不睡等真实时间。
 */

export type HoverEvent = 'close' | 'none'

export interface HoverTimer {
  /** 面板被叫出来：开始计「离开多久收」。再点一次会重新计。 */
  open(): void
  /**
   * 重新给一整段窗口：延时到点，但调用方决定**先不收**。
   *
   * 用在吃饭那口正到嘴边的时候——菜单抽走会把用户的手落空。
   * 为什么不是调 `open()`：它把 `leftAt` 清空，于是 `pendingMs()` 返回 null，
   * 调用方就再也不会挂那个自驱定时器。主进程对相同坐标去重，手停住不动时
   * 根本没有第二次 `onPoint` 进来，面板会永远挂在屏幕上（饭后也收不掉）。
   */
  postpone(): void
  /** 每次光标位置进来调用一次（主进程 33ms 推进来，或调用方自己催）。 */
  onPoint(p: Point, overBody: boolean, overPanel: boolean): HoverEvent
  /**
   * 距下一次自动收起还剩多少毫秒；没有挂起的转换返回 null。
   *
   * 主进程对相同坐标去重，手真的停住不动时不会再有 onPoint 进来。
   * 调用方拿这个值挂一个 setTimeout，到点用最后那个坐标再喂一次，
   * 「离开 1500ms 自动收起」才是计时到点自己发生，而不是靠用户再动一下鼠标。
   */
  pendingMs(now: number): number | null
  /**
   * 换收起延时。设置与食物列表要逐个点、逐个挑，1500ms 不够操作完；
   * 回动作视图时换回来。
   */
  setHideMs(ms: number): void
  /** 面板被别的路收掉了（拖拽、点气泡的回应、皮肤切换）：立刻停表，别再补一条 close。 */
  reset(): void
}

export function createHoverTimer(now: () => number): HoverTimer {
  /** 面板处于「开着，离开一段时间就收」的状态。 */
  let armed = false
  let leftAt: number | null = null
  let hideMs = PANEL_HIDE_MS

  return {
    open() {
      armed = true
      leftAt = null
    },
    postpone() {
      // onPoint 报 'close' 时已经把 armed 落下去了（它的语义是「这次真收」），
      // 所以这里必须整个重新上弦，不能只看 leftAt。
      armed = true
      leftAt = now()
    },
    onPoint(_p: Point, overBody: boolean, overPanel: boolean): HoverEvent {
      if (overBody || overPanel) {
        leftAt = null
        return 'none'
      }
      if (!armed) return 'none'
      leftAt ??= now()
      if (now() - leftAt < hideMs) return 'none'
      armed = false
      leftAt = null
      return 'close'
    },
    pendingMs(t: number): number | null {
      if (!armed || leftAt === null) return null
      return Math.max(0, hideMs - (t - leftAt))
    },
    reset() {
      armed = false
      leftAt = null
      hideMs = PANEL_HIDE_MS
    },
    setHideMs(ms: number): void {
      hideMs = ms
    },
  }
}
