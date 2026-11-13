import { describe, expect, it, vi } from 'vitest'
import { createTrayController, type TrayMenuItem, type TrayRuntime } from '../src/main/tray.js'
import type { Settings } from '../src/shared/visibility.js'

function setup(settings: Settings = { onFullscreen: 'show', developerMode: false, muted: false }) {
  const templates: TrayMenuItem[][] = []
  const listeners = new Map<string, () => void>()
  const port = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => { listeners.set(event, cb) }),
    destroy: vi.fn(),
  }
  const runtime: TrayRuntime = {
    loadIcon: vi.fn(() => ({ icon: true })),
    isIconEmpty: vi.fn(() => false),
    createTray: vi.fn(() => port),
    buildMenu: vi.fn((template) => {
      templates.push(template)
      return { template }
    }),
  }
  const deps = {
    iconPath: 'assets/with-me.ico',
    getSettings: vi.fn(() => settings),
    listSkins: vi.fn(() => [{ id: 'block', name: '色块' }, { id: 'dafeiyu', name: '大肥鱼' }]),
    getSkin: vi.fn(() => 'block'),
    selectSkin: vi.fn(),
    importSkin: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    updateSettings: vi.fn(),
    quit: vi.fn(),
    reportError: vi.fn(),
  }
  const controller = createTrayController(deps, runtime)
  return { controller, deps, runtime, port, templates, listeners }
}

describe('tray controller', () => {
  it('builds the agreed menu in order and reflects settings', () => {
    const { templates, port } = setup({ onFullscreen: 'hide', developerMode: true, muted: true })

    expect(templates).toHaveLength(1)
    expect(templates[0]!.map((i) => i.label ?? i.type)).toEqual([
      '显示桌宠', '隐藏桌宠', 'separator', '静音', '全屏时隐藏', '开发者模式', 'separator', '皮肤', 'separator', '退出',
    ])
    expect(templates[0]![3]).toMatchObject({ type: 'checkbox', checked: true })
    expect(templates[0]![4]).toMatchObject({ type: 'checkbox', checked: true })
    expect(templates[0]![5]).toMatchObject({ type: 'checkbox', checked: true })
    expect(port.setToolTip).toHaveBeenCalledWith('with-me')
    expect(port.setContextMenu).toHaveBeenCalledOnce()
  })

  it('delegates show, hide, exit, and double click', () => {
    const { templates, deps, listeners } = setup()
    templates[0]![0]!.click?.({ checked: false })
    templates[0]![1]!.click?.({ checked: false })
    templates[0]![9]!.click?.({ checked: false })
    listeners.get('double-click')?.()

    expect(deps.show).toHaveBeenCalledTimes(2)
    expect(deps.hide).toHaveBeenCalledOnce()
    expect(deps.quit).toHaveBeenCalledOnce()
  })

  it('sends only the setting changed by each checkbox', () => {
    const { templates, deps } = setup()
    templates[0]![3]!.click?.({ checked: true })
    templates[0]![4]!.click?.({ checked: true })
    templates[0]![5]!.click?.({ checked: true })

    expect(deps.updateSettings.mock.calls).toEqual([
      [{ muted: true }],
      [{ onFullscreen: 'hide' }],
      [{ developerMode: true }],
    ])
  })

  it('皮肤子菜单列出所有皮肤并标出当前项，点击委托切换', () => {
    const { templates, deps } = setup()
    const skins = templates[0]![7]!
    expect(skins.label).toBe('皮肤')
    expect(skins.submenu?.map((i) => i.label)).toEqual(['色块', '大肥鱼', undefined, '导入皮肤包…'])
    expect(skins.submenu?.map((i) => i.checked)).toEqual([true, false, undefined, undefined])
    skins.submenu![1]!.click?.({ checked: false })
    expect(deps.selectSkin).toHaveBeenCalledWith('dafeiyu')
    skins.submenu![3]!.click?.({ checked: false })
    expect(deps.importSkin).toHaveBeenCalledOnce()
  })

  it('refresh rebuilds from current settings and dispose is idempotent', () => {
    let current: Settings = { onFullscreen: 'show', developerMode: false, muted: false }
    const s = setup(current)
    s.deps.getSettings.mockImplementation(() => current)
    current = { onFullscreen: 'hide', developerMode: true, muted: true }
    s.controller.refresh()
    s.controller.dispose()
    s.controller.dispose()

    expect(s.templates).toHaveLength(2)
    expect(s.templates[1]![3]!.checked).toBe(true)
    expect(s.templates[1]![4]!.checked).toBe(true)
    expect(s.templates[1]![5]!.checked).toBe(true)
    expect(s.port.destroy).toHaveBeenCalledOnce()
  })

  it('returns a harmless controller when the icon is empty or tray creation throws', () => {
    const empty = setup()
    empty.controller.dispose()

    const runtime: TrayRuntime = {
      loadIcon: () => ({}),
      isIconEmpty: () => true,
      createTray: () => { throw new Error('must not create') },
      buildMenu: () => ({}),
    }
    const reportError = vi.fn()
    const controller = createTrayController({
      iconPath: 'missing.ico',
      getSettings: () => ({ onFullscreen: 'show', developerMode: false, muted: false }),
      listSkins: () => [], getSkin: () => 'block', selectSkin: vi.fn(), importSkin: vi.fn(),
      show: vi.fn(), hide: vi.fn(), updateSettings: vi.fn(), quit: vi.fn(), reportError,
    }, runtime)
    controller.refresh()
    controller.dispose()

    expect(reportError).toHaveBeenCalledOnce()
  })
})
