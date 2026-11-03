/**
 * 可见性策略：把系统读数翻译成场景，再把「场景 + 用户设置」翻译成显不显示。
 *
 * 两半都放这里，是因为它们都得被主进程和单测同时用到，而判断逻辑只有这么一点——
 * 拆成两个文件只是让找的人多跳一次。
 *
 * 实测依据（spike/fs-probe2.ps1，本机）：窗口化和最大化读 5，
 * 浏览器网页全屏与视频全屏都读 2，且全屏时 topmost 窗口仍然在最上面。
 */

export type Scenario = 'none' | 'fullscreen' | 'presentation'
export type Visibility = 'show' | 'hide'

export type Settings = {
  /** 有程序占满整块屏时（视频/网页/无边框游戏全屏）。 */
  onFullscreen: Visibility
  /** 放映、演示模式时。 */
  onPresentation: Visibility
}

/** 用户拍定的默认值：任何时候都陪着。 */
export const DEFAULT_SETTINGS: Settings = { onFullscreen: 'show', onPresentation: 'show' }

const VISIBILITIES: readonly Visibility[] = ['show', 'hide']

export function isVisibility(v: unknown): v is Visibility {
  return VISIBILITIES.includes(v as Visibility)
}

/**
 * @param state SHQueryUserNotificationState 的读数
 * @param coversMonitor 前台窗口是否铺满整块显示器。调用方必须先把系统外壳界面排除掉
 *        （main/visibility.ts 的 SHELL_CLASSES）——实测锁屏界面的矩形正好是
 *        0,0-1600,1000，不排掉的话宠物一启动就把自己藏掉。
 *
 * 为什么两条判据都要：通知状态只认得「独占全屏」和「演示模式」。实测浏览器视频全屏
 * 会读 2，但 Electron 那种无边框全屏窗口（不少播放器也是这个做法）读数一直是 1/5，
 * 只靠 state 就漏掉——而那恰恰是用户会设「隐藏」的场景。
 */
export function mapScenario(state: number, coversMonitor: boolean): Scenario {
  // 放映优先：PPT 放映同样铺满整屏，先认 4 才不会被下面那条吞成普通全屏
  if (state === 4) return 'presentation'
  if (state === 2 || state === 3 || coversMonitor) return 'fullscreen'
  return 'none'
}

/** @returns true = 显示宠物 */
export function decideVisibility(scenario: Scenario, s: Settings): boolean {
  if (scenario === 'fullscreen') return s.onFullscreen === 'show'
  if (scenario === 'presentation') return s.onPresentation === 'show'
  return true
}
