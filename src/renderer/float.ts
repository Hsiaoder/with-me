import { FLOAT_MS } from '../shared/config.js'
import type { Point } from '../shared/types.js'

/**
 * 属性变化时飘出来的小数字（「饥饿 +12」）。
 *
 * 三条设计上的决定，都不是随手挑的：
 *
 * ① **它不吃命中，也不挂 `data-hit`**。面板和气泡都挂 `data-hit`，因为用户可以点它们；
 *    飘字不能点，所以它必须对命中判定完全隐形——否则它就成了「看不见却抢鼠标」那种
 *    中间状态（problem/01 §1.15 那条老规矩：交互区只算看得见且归我们管的那几块）。
 *    它活一秒，宠物在这一秒里怎么走都不会把它带出交互区，这是刻意的。
 * ② **清理靠定时器，不靠 `animationend`**。系统开「减少动效」时 style.css 把
 *    `.pet-float` 的动画整条关掉，那时候 `animationend` 永远不来，飘字就会堆在屏幕上不掉。
 *    生命周期归 JS，视觉归 CSS，两边各管一段。
 * ③ **`aria-hidden`**。数字是给眼睛的即时反馈，读屏该读的是状态栏里那条真值；
 *    挂成 `role="status"` 会让每次喂食都念一遍「饥饿加12」，那是打扰。
 */

export interface FloatLayer {
  readonly el: HTMLElement
  /** 现在屏幕上还有几条。0 时整层已经移出布局。 */
  readonly count: number
  /** 贴一批新的（由上往下排，新的一条接在下面）。空数组什么都不做。 */
  show(items: readonly string[]): void
  /** 跟着宠物挪。只在有字时写 transform。 */
  place(at: Point): void
  /** 全部撤掉（拖拽时和气泡一起清：人被拎起来了，那串数字也不是他此刻要读的东西）。 */
  clear(): void
}

export function createFloatLayer(root: HTMLElement): FloatLayer {
  const el = document.createElement('div')
  el.className = 'pet-floats'
  el.setAttribute('aria-hidden', 'true')
  el.hidden = true
  root.append(el)

  /** 每条字配一个自己的到期定时器；clear() 要能全部撤掉，不然旧定时器会来删新芯片。 */
  const timers = new Set<ReturnType<typeof setTimeout>>()

  function drop(chip: HTMLElement, timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer)
    timers.delete(timer)
    chip.remove()
    if (timers.size === 0) el.hidden = true
  }

  return {
    el,
    get count() {
      return timers.size
    },
    show(items) {
      if (items.length === 0) return
      for (const text of items) {
        const chip = document.createElement('div')
        chip.className = 'pet-float'
        chip.textContent = text
        el.append(chip)
        const timer = setTimeout(() => drop(chip, timer), FLOAT_MS)
        timers.add(timer)
      }
      el.hidden = false
    },
    place(at) {
      if (timers.size === 0) return
      el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`
    },
    clear() {
      for (const t of timers) clearTimeout(t)
      timers.clear()
      el.replaceChildren()
      el.hidden = true
    },
  }
}
