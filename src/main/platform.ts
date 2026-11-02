import type { Point } from '../shared/types.js'

/**
 * 平台层的全部能力。业务代码只认这几个动作，不许出现 Electron 的窗口 API
 * ——将来加 macOS 时，差异只落在这一层的另一个实现里。
 */
export interface Platform {
  /** 建窗。整屏覆盖层尺寸 = 主屏工作区，之后永不移动、永不改大小。 */
  createWindow(): void
  /** true = 接住鼠标（关闭穿透）。 */
  setInteractive(on: boolean): void
  /** 把系统光标位置推给渲染层。穿透状态下网页收不到 mousemove，只能从外面喂。 */
  sendCursor(p: Point): void
  /** 面板里有输入框时才临时可聚焦。 */
  setFocusable(on: boolean): void
  /** 页面加载完成时回调一次。首屏数据（皮肤）必须等这个时机才发得出去。 */
  onPageReady(cb: () => void): void
  /** 向渲染层发一条消息。业务语义在调用方，这里只负责搬运。 */
  send(channel: string, payload: unknown): void
  show(): void
  hide(): void
}
