import { describe, it, expect } from 'vitest'
import { alphaStats, diffScreens } from '../spike/analyze.mjs'

/** 造一张 w*h 的 BGRA 位图，默认全黑不透明。 */
function bitmap(w: number, h: number, fill: number[] = [0, 0, 0, 255]): Uint8Array {
  const b = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) b.set(fill, i * 4)
  return b
}

function paint(b: Uint8Array, w: number, x: number, y: number, color: number[]): void {
  b.set(color, (y * w + x) * 4)
}

const PET = { x: 10, y: 10, w: 20, h: 20 }

describe('diffScreens', () => {
  it('两张一样的图没有变化', () => {
    const a = bitmap(64, 32)
    const r = diffScreens(a, bitmap(64, 32), { width: 64, height: 32 }, 1, [PET])
    expect(r).toMatchObject({ changed: 0, outsideExpected: 0, bbox: null })
  })

  it('变化落在宠物框内时不计入框外', () => {
    const base = bitmap(64, 32)
    const shot = bitmap(64, 32)
    paint(shot, 64, 12, 12, [255, 0, 0, 255])
    const r = diffScreens(base, shot, { width: 64, height: 32 }, 1, [PET])
    expect(r.changed).toBe(1)
    expect(r.outsideExpected).toBe(0)
    expect(r.bbox).toEqual({ x: 12, y: 12, w: 1, h: 1 })
  })

  it('框外漏色被抓住，且外接框包住整块屏幕', () => {
    const base = bitmap(64, 32)
    const shot = bitmap(64, 32)
    paint(shot, 64, 12, 12, [255, 0, 0, 255])   // 宠物
    paint(shot, 64, 60, 30, [0, 255, 0, 255])   // 右下角漏了一块
    const r = diffScreens(base, shot, { width: 64, height: 32 }, 1, [PET])
    expect(r.outsideExpected).toBe(1)
    expect(r.bbox).toEqual({ x: 12, y: 12, w: 49, h: 19 })
  })

  it('小于阈值的抖动不算变化', () => {
    const base = bitmap(64, 32)
    const shot = bitmap(64, 32)
    paint(shot, 64, 40, 5, [7, 0, 0, 255])
    expect(diffScreens(base, shot, { width: 64, height: 32 }, 1, [PET]).changed).toBe(0)
  })

  it('CSS 矩形按 scaleFactor 换算到设备像素', () => {
    const base = bitmap(64, 32)
    const shot = bitmap(64, 32)
    // scale=2 时 PET 覆盖设备像素 x:20..59, y:20..59；(30,25) 在框内，(62,10) 在框外
    paint(shot, 64, 30, 25, [255, 0, 0, 255])
    paint(shot, 64, 62, 10, [255, 0, 0, 255])
    const r = diffScreens(base, shot, { width: 64, height: 32 }, 2, [PET])
    expect(r.changed).toBe(2)
    expect(r.outsideExpected).toBe(1)
  })
})

describe('alphaStats', () => {
  it('宠物框内不透明、框外全透明时判定干净', () => {
    const b = bitmap(64, 32, [0, 0, 0, 0])
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) paint(b, 64, x, y, [255, 0, 0, 255])
    const r = alphaStats(b, { width: 64, height: 32 }, 1, [PET])
    expect(r.outsideSamples).toBe(64 * 32 - 20 * 20)
    expect(r.outsideOpaque).toBe(0)
    expect(r.outsideAlphaMax).toBe(0)
    expect(r.insideOpaque).toBe(400)
    expect(r.insideAlphaMax).toBe(255)
  })

  it('框外有一层半透明底时报警', () => {
    const b = bitmap(64, 32, [128, 128, 128, 30])   // 整屏蒙了一层 alpha=30 的灰
    const r = alphaStats(b, { width: 64, height: 32 }, 1, [PET])
    expect(r.outsideOpaque).toBe(r.outsideSamples)
    expect(r.outsideAlphaMax).toBe(30)
  })

  it('提示框这类本来就不透明的元素算进预期区域，不误报', () => {
    const b = bitmap(64, 32, [0, 0, 0, 0])
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) paint(b, 64, x, y, [255, 0, 0, 255])
    for (let y = 2; y < 8; y++) for (let x = 40; x < 60; x++) paint(b, 64, x, y, [255, 255, 255, 255])
    const tip = { x: 40, y: 2, w: 20, h: 6 }
    expect(alphaStats(b, { width: 64, height: 32 }, 1, [PET]).outsideOpaque).toBe(120)
    expect(alphaStats(b, { width: 64, height: 32 }, 1, [PET, tip]).outsideOpaque).toBe(0)
  })
})

describe('diffScreens 的比较范围', () => {
  it('roi 之外的变化不扫，避免把别的应用动一下算成漏色', () => {
    const base = bitmap(64, 32)
    const shot = bitmap(64, 32)
    paint(shot, 64, 12, 12, [255, 0, 0, 255])   // 宠物框内
    paint(shot, 64, 60, 30, [0, 255, 0, 255])   // 远处另一个窗口在动
    const full = diffScreens(base, shot, { width: 64, height: 32 }, 1, [PET])
    const roi = diffScreens(base, shot, { width: 64, height: 32 }, 1, [PET], { x: 5, y: 5, w: 30, h: 30 })
    expect(full.changed).toBe(2)
    expect(roi.changed).toBe(1)
    expect(roi.scanned).toBe(30 * 27)
    expect(roi.outsideExpected).toBe(0)
  })
})
