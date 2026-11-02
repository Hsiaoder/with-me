import { STAGE_H_CSS, STAGE_W_CSS } from '../shared/config.js'
import type { Rect } from '../shared/types.js'

/**
 * 舞台 DOM：一个定位用的外层 + 两个 <video>（由播放器挂进去）。
 * 这里只管位置、镜像和两个调试用的可视化层，不碰播放逻辑。
 */

export interface Sprite {
  /** 两个 video 挂在它下面。 */
  readonly stage: HTMLElement
  /** 舞台左上角，覆盖层 CSS 坐标。用 transform 而不是 left/top，避免每帧触发布局。 */
  moveTo(x: number, y: number): void
  /** 朝左时镜像朝右的素材。 */
  setFlip(on: boolean): void
  /** F9 命中区可视化。传 null 关掉。 */
  showOutline(rect: Rect | null): void
  /** 皮肤不合法时把错误摊在屏幕上，不静默换默认皮肤。 */
  showError(lines: string[]): void
}

export function createSprite(root: HTMLElement): Sprite {
  const wrap = document.createElement('div')
  wrap.className = 'pet-sprite'
  const stage = document.createElement('div')
  stage.className = 'pet-stage'
  stage.style.width = `${STAGE_W_CSS}px`
  stage.style.height = `${STAGE_H_CSS}px`
  wrap.append(stage)
  root.append(wrap)

  let outline: HTMLElement | null = null
  let errorBox: HTMLElement | null = null

  return {
    stage,
    moveTo(x, y) {
      wrap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    },
    setFlip(on) {
      stage.classList.toggle('flip', on)
    },
    showOutline(rect) {
      if (!rect) {
        outline?.remove()
        outline = null
        return
      }
      outline ??= (() => {
        const el = document.createElement('div')
        el.className = 'hit-outline'
        root.append(el)
        return el
      })()
      outline.style.left = `${rect.x}px`
      outline.style.top = `${rect.y}px`
      outline.style.width = `${rect.w}px`
      outline.style.height = `${rect.h}px`
    },
    showError(lines) {
      errorBox?.remove()
      errorBox = document.createElement('pre')
      errorBox.className = 'skin-error'
      errorBox.textContent = lines.join('\n')
      root.append(errorBox)
    },
  }
}
