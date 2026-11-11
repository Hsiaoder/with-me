import { describe, expect, it } from 'vitest'
import { ALL_CLIPS } from '../src/shared/animation.js'
import { GUESS_ACTIONS, GUESS_POOL } from '../src/shared/guess.js'
import { DAFEIYU_ID, missingClipFiles, missingProductClips, packManifest } from '../src/shared/skin-pack.js'

/** 造一条「产品要的具名片段全给齐」的池表：名单来自 animation.ts / guess.ts，不抄死数。 */
function fullPools(): Record<string, string[]> {
  const pools: Record<string, string[]> = {
    idle: ['breath'], turn: ['look'], move: ['float'], click: ['wave'], drag: ['grab'],
  }
  const add = (pool: string, name: string): void => {
    if (!pools[pool]) pools[pool] = []
    if (!pools[pool]?.includes(name)) pools[pool]?.push(name)
  }
  for (const c of ALL_CLIPS) add(c.pool, c.name)
  for (const a of GUESS_ACTIONS) add(GUESS_POOL, a.name)
  return pools
}

const RAW = {
  formatVersion: 1,
  name: 'DSH 原片试穿（不入库）',
  author: '直接切自 dsh-pet app.asar 的 alpha 原片，未抠像未重编码',
  canvas: { w: 640, h: 360, feetY: 351 },
  bodyBox: { x: 110, y: 21, w: 408, h: 336 },
  pools: fullPools(),
}

describe('packManifest：试穿皮肤 → 发布皮肤', () => {
  it('换上发布用的名字/作者/许可，且仍然过皮肤契约', () => {
    const got = packManifest(RAW)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    const m = JSON.parse(got.json) as Record<string, unknown>
    expect(m.name).toBe('大肥鱼')
    expect(m.author).toMatch(/PC2005-cloud/)
    expect(m.author).not.toMatch(/不入库|试穿/)
    expect(m.license).toBe('CC BY-NC-SA 4.0')
    expect(m.attribution).toContain('https://github.com/PC2005-cloud/dsh-pet')
    // 几何必须原样带过去：改了它，命中框和摆位就全错
    expect(m.bodyBox).toEqual(RAW.bodyBox)
    expect(m.canvas).toEqual(RAW.canvas)
  })

  it('缺池就不出包：报告缺失的必需池', () => {
    const pools = fullPools()
    delete pools.drag
    const got = packManifest({ ...RAW, pools })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.errors.join('\n')).toMatch(/drag/)
  })

  it('源皮肤本身不合法时，报错指向源文件而不是我们改完的那份', () => {
    const got = packManifest({ ...RAW, canvas: { w: 100, h: 100, feetY: 90 } })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.errors.join('\n')).toMatch(/画布尺寸/)
  })

  it('发布 id 必须是路径安全的小写名（目录名不能写「大肥鱼」）', () => {
    expect(DAFEIYU_ID).toBe('dafeiyu')
    expect(/^[a-z][a-z0-9_-]{0,63}$/.test(DAFEIYU_ID)).toBe(true)
  })
})

describe('missingProductClips', () => {
  it('片段齐全时不报', () => {
    expect(missingProductClips(fullPools())).toEqual([])
  })

  it('少一条启动片就点名它', () => {
    const pools = fullPools()
    pools.guess = (pools.guess ?? []).filter((n) => n !== 'liondance')
    expect(missingProductClips(pools)).toContain('guess/liondance')
  })

  it('少一条退出片也点名', () => {
    const pools = fullPools()
    pools.daily = (pools.daily ?? []).filter((n) => n !== 'archive')
    expect(missingProductClips(pools)).toContain('daily/archive')
  })

  it('猜动作少一条点名到 guess 池', () => {
    const pools = fullPools()
    pools.guess = (pools.guess ?? []).filter((n) => n !== 'riverlamp')
    expect(missingProductClips(pools)).toContain('guess/riverlamp')
  })

  it('整个池没了不会漏报（空池等于缺）', () => {
    const pools = fullPools()
    pools.guess = []
    const missing = missingProductClips(pools)
    for (const a of GUESS_ACTIONS) expect(missing, `guess/${a.name}`).toContain(`guess/${a.name}`)
  })
})

describe('missingClipFiles：manifest 写了名字，磁盘上还得真有这一段', () => {
  const pools = { idle: ['breath'], guess: ['liondance', 'swing'] }

  it('文件都在就不报', () => {
    expect(missingClipFiles(pools, () => true)).toEqual([])
  })

  it('名字写了但磁盘没有的，逐条点名（防的是 0 段也出一个包）', () => {
    const got = missingClipFiles(pools, (pool, name) => pool === 'idle' && name === 'breath')
    expect(got).toEqual(['guess/liondance.webm', 'guess/swing.webm'])
  })

  it('查的是 pool/name 两级路径，不会拿别的池的同名片段顶数', () => {
    // daily/archive 存在不等于 guess/archive 存在
    expect(missingClipFiles({ guess: ['archive'] }, (pool) => pool === 'daily')).toEqual(['guess/archive.webm'])
  })
})
