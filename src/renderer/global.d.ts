import type { ClipRef, Point } from '../shared/types.js'

/**
 * preload 暴露的白名单。类型要和 src/preload/index.cjs 手工对齐——
 * 那是一份零 import 的 cjs，没法 import 这里的类型（通道名一致性由测试锁定）。
 *
 * 声明成可选：jsdom 里跑面板单测时没有 preload，渲染层要能优雅地什么都不做。
 */
declare global {
  interface Window {
    petBridge?: {
      onCursor(cb: (p: Point) => void): void
      onSkin(cb: (skin: unknown) => void): void
      requestGrab(grab: boolean): void
      setFocusable(on: boolean): void
      setDebugOverlay(on: boolean): void
      playClip(clip: ClipRef): void
    }
  }
}

export {}
