import { describe, it, expect } from 'vitest'
import {
  decideVisibility,
  mapScenario,
  DEFAULT_SETTINGS,
  type Settings,
} from '../src/shared/visibility.js'

/**
 * 可见性策略的两半：把系统读数翻译成场景，再把场景 + 用户设置翻译成显不显示。
 * 拆成两个纯函数是因为第一半要拿真机实测值喂（spike/fs-probe2.ps1 量到的 2/5），
 * 第二半是纯产品规则，全组合都要钉住。
 */

describe('mapScenario', () => {
  /**
   * 几何判据（covers）必须和「排掉系统外壳界面」配套。实测踩过：
   * 锁屏界面（LockApp，类名 Windows.UI.Core.CoreWindow）的矩形正好是 0,0-1600,1000，
   * 不排掉的话宠物一启动就把自己藏掉。排除表在 main/visibility.ts 的脚本里。
   */
  it('state=4 优先算放映，即使它同样铺满整屏', () => {
    expect(mapScenario(4, true)).toBe('presentation')
    expect(mapScenario(4, false)).toBe('presentation')
  })

  it('state 2 与 3 都算全屏', () => {
    // 2 是实测值：Chrome 网页 F11 和视频全屏都读 2；3 是 D3D 独占全屏
    expect(mapScenario(2, false)).toBe('fullscreen')
    expect(mapScenario(3, false)).toBe('fullscreen')
  })

  it('通知状态不涨、但窗口铺满整屏，也算全屏', () => {
    // 实测：Electron 那种无边框全屏窗口（不少播放器也是这个做法）state 一直读 1/5，
    // 只靠通知状态就漏掉——而那恰恰是用户会设「隐藏」的场景
    expect(mapScenario(5, true)).toBe('fullscreen')
    expect(mapScenario(1, true)).toBe('fullscreen')
  })

  it('平时（通知状态没涨、也没铺满）是 none', () => {
    for (const s of [0, 1, 5, 6, 7, 8]) expect(mapScenario(s, false), `state=${s}`).toBe('none')
  })

  it('越界的状态值算 none，不许把宠物藏起来', () => {
    for (const s of [99, -1, NaN]) expect(mapScenario(s, false), `state=${s}`).toBe('none')
  })
})

describe('decideVisibility', () => {
  const at = (onFullscreen: 'show' | 'hide', onPresentation: 'show' | 'hide'): Settings =>
    ({ onFullscreen, onPresentation, developerMode: false, muted: false })

  it('没有全屏时永远显示，设置管不着', () => {
    for (const s of [at('show', 'show'), at('hide', 'hide'), at('hide', 'show')]) {
      expect(decideVisibility('none', s)).toBe(true)
    }
  })

  it('全屏场景只看 onFullscreen', () => {
    expect(decideVisibility('fullscreen', at('show', 'hide'))).toBe(true)
    expect(decideVisibility('fullscreen', at('hide', 'show'))).toBe(false)
  })

  it('放映场景只看 onPresentation', () => {
    expect(decideVisibility('presentation', at('hide', 'show'))).toBe(true)
    expect(decideVisibility('presentation', at('show', 'hide'))).toBe(false)
  })

  it('默认设置下任何场景都显示（用户拍定的默认值）', () => {
    for (const sc of ['none', 'fullscreen', 'presentation'] as const) {
      expect(decideVisibility(sc, DEFAULT_SETTINGS), sc).toBe(true)
    }
  })
})
