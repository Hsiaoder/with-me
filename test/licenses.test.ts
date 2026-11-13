import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { auditAssets, findForbidden, type LicenseEntry } from '../src/shared/licenses.js'

const E = (path: string, license = 'CC0-1.0', source = 'Kenney'): LicenseEntry => ({ path, license, source })

describe('auditAssets：登记齐不齐（只喂源树）', () => {
  it('目录条目覆盖它下面的所有文件', () => {
    expect(auditAssets([E('src/renderer/icons/')], ['src/renderer/icons/a.svg', 'src/renderer/icons/sub/b.svg']))
      .toEqual([])
  })

  it('精确文件条目算覆盖', () => {
    const e = E('src/renderer/fonts/with-me-sans-var.woff2', 'OFL-1.1')
    expect(auditAssets([e], ['src/renderer/fonts/with-me-sans-var.woff2'])).toEqual([])
  })

  it('未登记的文件报出来', () => {
    const got = auditAssets([E('src/renderer/icons/')],
      ['src/renderer/icons/a.svg', 'src/renderer/emotes/bubble.svg'])
    expect(got).toEqual([{ file: 'src/renderer/emotes/bubble.svg', reason: '没有登记到 licenses.json' }])
  })

  it('登记了但没有任何文件命中的条目算漂移', () => {
    const got = auditAssets([E('src/renderer/foods/')], ['src/renderer/icons/a.svg'])
    expect(got.map((f) => f.reason)).toContain('登记了却没有任何文件命中：src/renderer/foods/')
  })

  it('精确条目与目录条目同时命中时，两条都算用上了', () => {
    expect(auditAssets([E('src/renderer/fonts/OFL-noto-sans-sc.txt', 'OFL-1.1'), E('src/renderer/fonts/')],
      ['src/renderer/fonts/OFL-noto-sans-sc.txt'])).toEqual([])
  })
})

describe('findForbidden：不该出现的东西（只喂包树）', () => {
  it('形象素材目录混进包里 = 阻断', () => {
    expect(findForbidden(['release/win-unpacked/resources/app.asar.unpacked/skins/dafeiyu/a.webm'])[0]?.reason)
      .toMatch(/形象素材/)
  })

  it('dafeiyu / dshtry / 大肥鱼 三种写法都认', () => {
    for (const f of ['skins/dafeiyu/manifest.json', 'dist/renderer/dshtry.webm', 'release/大肥鱼.png']) {
      expect(findForbidden([f])[0]?.reason, f).toMatch(/形象素材/)
    }
  })

  it('带额外限制字样的文件进包 = 阻断（GPL 不许附加条件）', () => {
    expect(findForbidden(['dist/renderer/禁止商用.txt'])[0]?.reason).toMatch(/额外限制/)
  })

  it('iconfont 素材进包 = 阻断（上游许可禁止再分发）', () => {
    expect(findForbidden(['dist/renderer/icons/iconfont-气泡.svg'])[0]?.reason).toMatch(/iconfont/)
  })

  it('未登记的散装字体 .ttf/.otf 进包 = 阻断（只收 woff2 子集）', () => {
    for (const f of ['dist/renderer/fonts/NotoSansSC.ttf', 'dist/renderer/fonts/x.otf']) {
      expect(findForbidden([f])[0]?.reason, f).toMatch(/散装字体/)
    }
  })

  it('干净的包树什么都不报', () => {
    expect(findForbidden(['dist/renderer/index.html', 'dist/renderer/fonts/with-me-sans-var.woff2',
      'skins/block/animation/idle/patrol.webm'])).toEqual([])
  })
})

describe('应用图标与打包配置', () => {
  it('应用图标存在且是合法 ICO', () => {
    const buf = readFileSync('assets/with-me.ico')
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x00, 0x01, 0x00]))
    expect(buf.subarray(4, 6).readUInt16LE(0)).toBeGreaterThan(0)
  })

  it('licenses.json 登记了 assets/', () => {
    const entries = JSON.parse(readFileSync('licenses.json', 'utf8')) as LicenseEntry[]
    expect(entries.some((e) => e.path === 'assets/')).toBe(true)
  })

  it('builder 配置声明了 win.icon 与 extraResources 拷贝', () => {
    const yml = readFileSync('electron-builder.yml', 'utf8')
    expect(yml).toContain('win:\n  icon: assets/with-me.ico')
    expect(yml).toContain('extraResources:\n  - from: assets/with-me.ico\n    to: with-me.ico')
  })
})
