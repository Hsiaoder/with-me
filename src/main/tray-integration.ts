import type { Settings } from '../shared/visibility.js'

/**
 * 设置写入的唯一入口。托盘勾选和渲染层改设置都从这里走，一次调用依次完成：
 * 写存档 → 更新可见性 → 落盘 → 回灌渲染层 → 刷新托盘勾选。
 *
 * 顺序固定是有意的：先改内存再落盘，落盘失败也不影响本次会话；
 * 广播放在落盘之后，渲染层看到的永远是已经写进存档的值。
 */
export type SettingsHubDeps = {
  /** 套用补丁并返回完整的新设置（调用方负责写回 save）。 */
  applySettings(patch: Partial<Settings>): Settings
  setVisibility(settings: Settings): void
  persist(): void
  broadcast(settings: Settings): void
  refreshTray(): void
}

export function createSettingsHub(deps: SettingsHubDeps): (patch: Partial<Settings>) => void {
  return (patch) => {
    const next = deps.applySettings(patch)
    deps.setVisibility(next)
    deps.persist()
    deps.broadcast(next)
    deps.refreshTray()
  }
}

/** 托盘「退出」的兜底时长：渲染层卡死或根本没加载时，也必须退得出去。 */
export const TRAY_EXIT_FALLBACK_MS = 12_000

export type TrayExitDeps = {
  /** 清掉手动隐藏并把窗口亮出来，告别动画得让人看见。 */
  reveal(): void
  /** main → renderer：让渲染层走和面板一样的告别序列。 */
  sendQuitRequested(): void
  scheduleFallback(run: () => void, ms: number): unknown
  cancelFallback(handle: unknown): void
  quit(): void
}

export type TrayExit = {
  request(): void
  cancel(): void
}

/**
 * 托盘退出只允许启动一次：连点菜单不能重放告别动画、也不能叠出两个兜底定时器。
 * 正常路径是渲染层演完 farewell 后回头调 pet:quit 让主进程 quit；
 * 兜底路径是等不到回应时自己 quit。
 */
export function createTrayExit(deps: TrayExitDeps, fallbackMs = TRAY_EXIT_FALLBACK_MS): TrayExit {
  let pending = false
  let fallback: unknown = null

  return {
    request() {
      if (pending) return
      pending = true
      deps.reveal()
      deps.sendQuitRequested()
      fallback = deps.scheduleFallback(() => deps.quit(), fallbackMs)
    },
    cancel() {
      if (fallback === null) return
      deps.cancelFallback(fallback)
      fallback = null
    },
  }
}
