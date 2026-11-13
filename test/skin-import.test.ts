import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { inspectSkinPack, installSkinPack } from '../src/main/skin-import.js'

const manifest = {
  formatVersion: 1,
  name: '测试皮肤',
  canvas: { w: 640, h: 360, feetY: 351 },
  bodyBox: { x: 100, y: 10, w: 400, h: 340 },
  pools: {
    idle: ['breath'],
    turn: ['look'],
    move: ['float'],
    click: ['wave'],
    drag: ['grab'],
  },
  license: 'CC BY-NC-SA 4.0',
  attribution: '测试署名',
}

const clips = ['idle/breath', 'turn/look', 'move/float', 'click/wave', 'drag/grab']

const packFiles = (root = 'dafeiyu'): Record<string, Uint8Array> => {
  const out: Record<string, Uint8Array> = {
    [`${root}/manifest.json`]: strToU8(JSON.stringify(manifest)),
    [`${root}/ATTRIBUTION.md`]: strToU8('署名在这里'),
  }
  for (const clip of clips) out[`${root}/animation/${clip}.webm`] = new Uint8Array([1, 2, 3])
  return out
}

const zip = (files: Record<string, Uint8Array>): Uint8Array => zipSync(files)

const temps: string[] = []
const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'with-me-import-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('inspectSkinPack', () => {
  it('接受正常皮肤包，并把文件路径剥到皮肤根目录', () => {
    const got = inspectSkinPack(zip(packFiles()))
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.pack.id).toBe('dafeiyu')
    expect(got.pack.manifest.name).toBe('测试皮肤')
    expect(got.pack.license).toBe('CC BY-NC-SA 4.0')
    expect(got.pack.files['animation/idle/breath.webm']).toBeDefined()
  })

  it('自动剥掉用户多套的一层目录', () => {
    const got = inspectSkinPack(zip(packFiles('dafeiyu/dafeiyu')))
    expect(got.ok).toBe(true)
    if (got.ok) expect(got.pack.id).toBe('dafeiyu')
  })

  it('挡掉 ../ 路径穿越', () => {
    const files = packFiles()
    files['dafeiyu/../evil.txt'] = strToU8('x')
    const got = inspectSkinPack(zip(files))
    expect(got.ok).toBe(false)
    if (!got.ok) expect(got.error).toMatch(/非法路径/)
  })

  it('挡掉绝对路径', () => {
    const files = packFiles()
    files['/etc/evil.txt'] = strToU8('x')
    const got = inspectSkinPack(zip(files))
    expect(got.ok).toBe(false)
    if (!got.ok) expect(got.error).toMatch(/非法路径/)
  })

  it('挡掉可执行文件', () => {
    const files = packFiles()
    files['dafeiyu/evil.exe'] = strToU8('MZ')
    const got = inspectSkinPack(zip(files))
    expect(got.ok).toBe(false)
    if (!got.ok) expect(got.error).toMatch(/不支持的文件类型/)
  })

  it('顶层多个目录直接拒掉', () => {
    const files = packFiles()
    files['other/readme.txt'] = strToU8('x')
    const got = inspectSkinPack(zip(files))
    expect(got.ok).toBe(false)
    if (!got.ok) expect(got.error).toMatch(/顶层/)
  })

  it('找不到 manifest 时报错', () => {
    const files = packFiles()
    delete files['dafeiyu/manifest.json']
    const got = inspectSkinPack(zip(files))
    expect(got.ok).toBe(false)
    if (!got.ok) expect(got.error).toMatch(/manifest/)
  })

  it('缺动画文件时报错', () => {
    const files = packFiles()
    delete files['dafeiyu/animation/idle/breath.webm']
    const got = inspectSkinPack(zip(files))
    expect(got.ok).toBe(false)
    if (!got.ok) expect(got.error).toMatch(/缺少/)
  })

  it('缺必需动作池时报错', () => {
    const files = packFiles()
    files['dafeiyu/manifest.json'] = strToU8(JSON.stringify({ ...manifest, pools: { idle: ['breath'] } }))
    const got = inspectSkinPack(zip(files))
    expect(got.ok).toBe(false)
    if (!got.ok) expect(got.error).toMatch(/必需动作池/)
  })
})

describe('installSkinPack', () => {
  it('把皮肤写进用户皮肤目录，重复导入会整目录替换', () => {
    const root = tempRoot()
    const skins = join(root, 'skins')

    const first = installSkinPack(zip(packFiles()), skins)
    expect(first.ok).toBe(true)
    expect(existsSync(join(skins, 'dafeiyu', 'manifest.json'))).toBe(true)
    expect(readFileSync(join(skins, 'dafeiyu', 'ATTRIBUTION.md'), 'utf8')).toBe('署名在这里')

    const files = packFiles()
    files['dafeiyu/ATTRIBUTION.md'] = strToU8('新署名')
    const second = installSkinPack(zip(files), skins)
    expect(second.ok).toBe(true)
    expect(readFileSync(join(skins, 'dafeiyu', 'ATTRIBUTION.md'), 'utf8')).toBe('新署名')
    expect(existsSync(`${join(skins, 'dafeiyu')}.old`)).toBe(false)
  })

  it('坏包不会在目标目录留下东西', () => {
    const root = tempRoot()
    const skins = join(root, 'skins')
    const files = packFiles()
    delete files['dafeiyu/animation/idle/breath.webm']

    const got = installSkinPack(zip(files), skins)
    expect(got.ok).toBe(false)
    expect(existsSync(join(skins, 'dafeiyu'))).toBe(false)
  })
})
