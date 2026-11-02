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
  /**
   * 窗口在本机的句柄（Windows 是 HWND 的十进制字符串）。
   * 全屏让路探测要拿它判断「前台那个窗口是不是宠物自己」——宠物窗铺满整屏，
   * 不区分的话它自己就会被当成有人在全屏。
   */
  windowHandle(): string
  show(): void
  hide(): void
}
