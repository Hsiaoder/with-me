import type { Point } from '../shared/types.js'

/**
 * 平台层的全部能力。业务代码只认这几个动作，不许出现 Electron 的窗口 API
 * ——将来加 macOS 时，差异只落在这一层的另一个实现里。
 */
export interface Platform {
  /** 建窗。整屏覆盖层尺寸 = 主屏工作区，之后永不移动；只在显示器工作区变化时由 setOverlayBounds 重摆。 */
  createWindow(): void
  /** true = 接住鼠标（关闭穿透）。 */
  setInteractive(on: boolean): void
  /**
   * 这条 IPC 消息是不是宠物那扇窗发的。渲染层→主进程每条通道先过这道闸：
   * 现在只有一扇窗，将来若多了设置窗/更新窗/任意可导航的 webContents，它们不能白拿改档、
   * 抢焦点、退进程这些高权限动作。
   */
  ownsSender(id: number): boolean
  /** 把系统光标位置推给渲染层。穿透状态下网页收不到 mousemove，只能从外面喂。 */
  sendCursor(p: Point): void
  /** 页面加载完成时回调一次。首屏数据（皮肤）必须等这个时机才发得出去。 */
  onPageReady(cb: () => void): void
  /** 向渲染层发一条消息。业务语义在调用方，这里只负责搬运。 */
  send(channel: string, payload: unknown): void
  show(): void
  hide(): void
  /**
   * 显示器工作区在运行中变了：把覆盖层重摆到新尺寸。
   * 只在真的变了时调（调用方自己比对，别让 Electron 无谓 setBounds——改尺寸是这个品类最容易抖的动作）。
   */
  setOverlayBounds(b: { x: number; y: number; width: number; height: number }): void
}
