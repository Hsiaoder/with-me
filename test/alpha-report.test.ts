import { describe, it, expect } from 'vitest'
import { join, resolve } from 'node:path'
import { analyzeAlpha, analyzeFile, listClips, locateClip, BG_ALPHA_WARN } from '../tools/alpha-report.mjs'
import { DEFAULT_BODY_BOX, SKIN_ANIMATION_DIR } from '../src/shared/config.js'

// 4x2 的 RGBA 帧：左半是身体（不透明），右半是背景（alpha=0）
const BODY = 255
const frame = new Uint8Array([
  10, 10, 10, BODY, 10, 10, 10, BODY, 0, 0, 0, 0, 0, 0, 0, 0,
  10, 10, 10, BODY, 10, 10, 10, BODY, 0, 0, 0, 0, 0, 0, 0, 0,
])
const bodyBox = { x: 0, y: 0, w: 2, h: 2 }

describe('analyzeAlpha', () => {
  it('只统计身体矩形之外的像素', () => {
    const r = analyzeAlpha(frame, 4, 2, bodyBox)
    expect(r.bgSamples).toBe(4)
    expect(r.bgAlphaMax).toBe(0)
    expect(r.bgAlphaMean).toBe(0)
    expect(r.haze).toBe(false)
  })

  it('背景残留超过阈值时报警告', () => {
    const hazy = new Uint8Array(frame)
    hazy[11] = 30
    hazy[15] = 20
    const r = analyzeAlpha(hazy, 4, 2, bodyBox)
    expect(r.bgAlphaMax).toBe(30)
    expect(r.bgAlphaMean).toBe(12.5)
    expect(r.haze).toBe(true)
  })

  it('阈值以下的小抖动不算灰雾', () => {
    const ok = new Uint8Array(frame)
    ok[11] = BG_ALPHA_WARN
    expect(analyzeAlpha(ok, 4, 2, bodyBox).haze).toBe(false)
  })

  it('身体矩形铺满整帧时没有背景样本，不误报', () => {
    const r = analyzeAlpha(frame, 4, 2, { x: 0, y: 0, w: 4, h: 2 })
    expect(r.bgSamples).toBe(0)
    expect(r.haze).toBe(false)
  })
})

// 这组要读真实产物，先跑 node tools/make-test-skin.mjs
describe('analyzeFile 对占位皮肤', () => {
  it('抽到多帧，且每帧的背景 alpha 都干净', () => {
    const files = listClips('skins/block')
    expect(files.length).toBeGreaterThanOrEqual(6)
    for (const f of files) {
      const r = analyzeFile(f, DEFAULT_BODY_BOX)
      expect(r.frames, f).toBeGreaterThan(1)
      expect(r.bgSamples, f).toBeGreaterThan(0)
      expect(r.bgAlphaMax, `${f} 背景残留 alpha=${r.bgAlphaMax}`).toBe(0)
    }
  })
})

describe('locateClip', () => {
  it('从素材路径回溯皮肤目录、池名与动画名', () => {
    const file = resolve(join('skins', 'mine', SKIN_ANIMATION_DIR, 'idle', 'patrol.webm'))
    expect(locateClip(file)).toEqual({
      skinDir: resolve(join('skins', 'mine')),
      pool: 'idle',
      name: 'patrol',
    })
  })

  it('名字里的后缀被剥掉，多级池目录保留', () => {
    const file = resolve(join('a', 'b', SKIN_ANIMATION_DIR, 'click', 'tapped.webm'))
    expect(locateClip(file)?.name).toBe('tapped')
    expect(locateClip(file)?.pool).toBe('click')
  })

  it('路径里没有 animation 段时返回 null，调用方好退回默认框', () => {
    expect(locateClip(resolve(join('other', 'thing.webm')))).toBeNull()
    // 少了动画名一段
    expect(locateClip(resolve(join('skins', 'x', SKIN_ANIMATION_DIR, 'idle')))).toBeNull()
  })
})

