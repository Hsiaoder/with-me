import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import type { Settings } from '../shared/visibility.js'

export type TrayMenuItem = {
  label?: string
  type?: 'separator' | 'checkbox' | 'radio'
  checked?: boolean
  click?: (item: { checked: boolean }) => void
  submenu?: TrayMenuItem[]
}

export interface TrayPort {
  setToolTip(text: string): void
  setContextMenu(menu: unknown): void
  on(event: 'double-click', listener: () => void): unknown
  destroy(): void
}

export interface TrayRuntime {
  loadIcon(path: string): unknown
  isIconEmpty(icon: unknown): boolean
  createTray(icon: unknown): TrayPort
  buildMenu(template: TrayMenuItem[]): unknown
}

export type TraySkin = { id: string; name: string }

export type TrayDeps = {
  iconPath: string
  getSettings(): Settings
  listSkins(): TraySkin[]
  getSkin(): string
  selectSkin(id: string): void
  importSkin(): void
  show(): void
  hide(): void
  updateSettings(patch: Partial<Settings>): void
  quit(): void
  reportError?(message: string, error?: unknown): void
}

export type TrayController = {
  refresh(): void
  dispose(): void
}

const noOpController = (): TrayController => ({ refresh() {}, dispose() {} })

const electronRuntime: TrayRuntime = {
  loadIcon: (path) => nativeImage.createFromPath(path),
  isIconEmpty: (icon) => (icon as NativeImage).isEmpty(),
  createTray: (icon) => new Tray(icon as NativeImage),
  buildMenu: (template) => Menu.buildFromTemplate(template as MenuItemConstructorOptions[]),
}

export function createTrayController(
  deps: TrayDeps,
  runtime: TrayRuntime = electronRuntime,
): TrayController {
  const reportError = deps.reportError ?? ((message: string, error?: unknown) => {
    console.error(`[tray] ${message}`, error ?? '')
  })

  let tray: TrayPort
  try {
    const icon = runtime.loadIcon(deps.iconPath)
    if (runtime.isIconEmpty(icon)) {
      reportError(`托盘图标无法读取：${deps.iconPath}`)
      return noOpController()
    }
    tray = runtime.createTray(icon)
    tray.setToolTip('with-me')
    tray.on('double-click', deps.show)
  } catch (error) {
    reportError('创建托盘失败', error)
    return noOpController()
  }

  let disposed = false
  const refresh = (): void => {
    if (disposed) return
    const settings = deps.getSettings()
    const template: TrayMenuItem[] = [
      { label: '显示桌宠', click: () => deps.show() },
      { label: '隐藏桌宠', click: () => deps.hide() },
      { type: 'separator' },
      {
        label: '静音',
        type: 'checkbox',
        checked: settings.muted,
        click: (item) => deps.updateSettings({ muted: item.checked }),
      },
      {
        label: '全屏时隐藏',
        type: 'checkbox',
        checked: settings.onFullscreen === 'hide',
        click: (item) => deps.updateSettings({ onFullscreen: item.checked ? 'hide' : 'show' }),
      },
      {
        label: '开发者模式',
        type: 'checkbox',
        checked: settings.developerMode,
        click: (item) => deps.updateSettings({ developerMode: item.checked }),
      },
      { type: 'separator' },
      {
        label: '皮肤',
        submenu: [
          ...deps.listSkins().map((skin) => ({
            label: skin.name,
            type: 'radio' as const,
            checked: skin.id === deps.getSkin(),
            click: () => deps.selectSkin(skin.id),
          })),
          { type: 'separator' as const },
          { label: '导入皮肤包…', click: () => deps.importSkin() },
        ],
      },
      { type: 'separator' },
      { label: '退出', click: () => deps.quit() },
    ]
    tray.setContextMenu(runtime.buildMenu(template))
  }

  refresh()
  return {
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      tray.destroy()
    },
  }
}
