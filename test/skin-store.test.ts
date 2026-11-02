import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadSkin } from '../src/main/skin-store.js'

const FIXTURE = join(tmpdir(), 'with-me-skin-fixture')

/** 造一个临时皮肤目录：可选地改掉 manifest，或干脆不放某个素材。 */
function makeSkin(name: string, opts: { manifest?: (raw: unknown) => unknown; skip?: string[] } = {}): string {
  const dir = join(FIXTURE, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const raw = JSON.parse(readFileSync('skins/block/manifest.json', 'utf8'))
  const manifest = opts.manifest ? opts.manifest(raw) : raw
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
  for (const [pool, names] of Object.entries(manifest.pools as Record<string, string[]>)) {
    mkdirSync(join(dir, 'animation', pool), { recursive: true })
    for (const clip of names) {
      const src = join('skins/block/animation', pool, `${clip}.webm`)
      if (opts.skip?.includes(`${pool}/${clip}`) || !existsSync(src)) continue
      writeFileSync(join(dir, 'animation', pool, `${clip}.webm`), readFileSync(src))
    }
  }
  return dir
}

afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }))

describe('内置色块皮肤', () => {
  it('结构合法、必需池齐全、每条素材都在', () => {
    const r = loadSkin('skins/block')
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(r.skin.pools.idle).toEqual(['patrol', 'patrol2'])
    expect(r.skin.pools.drag).toContain('pulled')
    expect(r.skin.dir).toBe(resolve('skins/block'))
  })
})

describe('loadSkin 的拒绝路径', () => {
  it('目录不存在时给一条可读错误，不抛异常', () => {
    const r = loadSkin(join(FIXTURE, 'nope'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('找不到皮肤清单')
  })

  it('manifest 不是合法 JSON 时报出来，不炸进程', () => {
    const dir = join(FIXTURE, 'bad-json')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), '{ 这不是 JSON', 'utf8')
    const r = loadSkin(dir)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('不是合法 JSON')
  })

  it('manifest 写了素材但文件不在，错误里点名是哪个文件', () => {
    const r = loadSkin(makeSkin('missing-clip', { skip: ['turn/left'] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('animation/turn/left.webm')
  })

  it('必需池的文件全被剔光后等同于缺池，不能放行', () => {
    const r = loadSkin(makeSkin('empty-required', { skip: ['drag/pulled'] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('没有一条素材真正存在')
  })

  it('一次性报出全部问题，不让作者改一个报一个', () => {
    const r = loadSkin(makeSkin('two-bad', { skip: ['turn/left', 'drag/pulled'] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('自定义池缺文件也拒绝，但不会误报成缺必需池', () => {
    const dir = makeSkin('extra-pool', {
      manifest: (raw) => {
        const m = raw as { pools: Record<string, string[]> }
        m.pools.sleep = ['nap']
        return m
      },
    })
    mkdirSync(join(dir, 'animation/sleep'), { recursive: true })
    const r = loadSkin(dir)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.join()).toContain('animation/sleep/nap.webm')
      expect(r.errors.join()).not.toContain('必需池里没有一条')
    }
  })
})
