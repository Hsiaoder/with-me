import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

/**
 * A 套「品牌蓝白」的素材不变量。
 *
 * 为什么要钉住：这两份素材是从 Kenney 包里抄来的，**换变体或重装素材会把原色盖回来**
 * （本仓库已经发生过一次：`button_round_line` → `button_round_depth_line` 时整套色都换了）。
 * 盖回来不会让任何功能测试变红——只是按钮又变回那枚灰紫硬币，得靠肉眼看。
 * 所以这里直接读文件本身：圆底看 fill 列表，底板解码像素数颜色。
 *
 * 重染的算法与门槛在 spike/palette-recolor.mjs 与 spike/color-math.mjs。
 */
const A = {
  面: '#ebf5fb',
  环: '#6990a7',
  底影: '#3e718c',
  内圈: '#36bdf7',
}
/** 素材原色：中性偏紫的灰，重染后一个都不该留 */
const STALE = ['#9696A3', '#747487', '#DADCE7']

const read = (rel: string) => readFileSync(resolve('src/renderer', rel), 'utf8')

describe('A 套配色：圆底 SVG', () => {
  const svg = read('icons/button_round_depth_line.svg')
  const fills = [...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => (m[1] ?? '').toLowerCase())

  it('四层目标色都在，且青内圈没被动过', () => {
    for (const want of [A.面, A.环, A.底影, A.内圈]) expect(fills, `缺 ${want}`).toContain(want)
  })

  it('素材原色（灰紫那三档）一个都不剩', () => {
    for (const stale of STALE) expect(fills, `还留着 ${stale}`).not.toContain(stale.toLowerCase())
  })
})

describe('A 套配色：底板 PNG', () => {
  const file = resolve('src/renderer', 'icons/button_rectangle_depth_line.png')
  const head = readFileSync(file)
  const W = head.readUInt32BE(16)
  const H = head.readUInt32BE(20)
  const raw = execFileSync(createRequire(import.meta.url)('ffmpeg-static'),
    ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 })

  /** 一个像素的四个通道；noUncheckedIndexedAccess 下 typed array 的索引也可能是 undefined */
  const channels = (p: number): [number, number, number, number] | null => {
    const [r, g, b, a] = [raw[p], raw[p + 1], raw[p + 2], raw[p + 3]]
    if (r === undefined || g === undefined || b === undefined || a === undefined) return null
    return [r, g, b, a]
  }

  const rgb = (x: number, y: number): [number, number, number] => {
    const c = channels((y * W + x) * 4)
    if (c === null) throw new Error(`越界：${x},${y}`)
    return [c[0], c[1], c[2]]
  }
  const near = (p: [number, number, number], hex: string): boolean => {
    const h = hex.replace('#', '')
    const t: [number, number, number] = [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]
    return Math.abs(p[0] - t[0]) <= 3 && Math.abs(p[1] - t[1]) <= 3 && Math.abs(p[2] - t[2]) <= 3
  }

  it('尺寸还是 192×64（重染不该改几何，改了说明 slice 契约要跟着重算）', () => {
    expect([W, H]).toEqual([192, 64])
  })

  it('左边框从外到内还是 环 → 白高光 → 留白 → 青内框 四层，只是色换了', () => {
    // 中线 y=32：源图实测 x0-1 灰环、2-3 白高光、4-5 留白、6-7 蓝线
    const mid = H >> 1
    expect(near(rgb(0, mid), A.环), '最外两层该是环色').toBe(true)
    expect(near(rgb(1, mid), A.环)).toBe(true)
    expect(near(rgb(6, mid), A.内圈), '第六七列该还是那条青蓝内框').toBe(true)
    expect(near(rgb(7, mid), A.内圈)).toBe(true)
    // 中间那格（slice 丢弃的部分）也重染成了面色，这样 4-5 列的留白带和板心同源
    expect(near(rgb(4, mid), A.面), '留白带该是面色').toBe(true)
  })

  it('旧的灰紫 (150,150,163) 在整个文件里绝迹', () => {
    let stale = 0
    for (let p = 0; p < raw.length; p += 4) {
      const c = channels(p)
      if (c === null || c[3] === 0) continue
      if (Math.abs(c[0] - 150) < 10 && Math.abs(c[2] - 163) < 10) stale++
    }
    expect(stale, `还有 ${stale} 个旧灰紫像素`).toBe(0)
  })

  it('青色内框的像素数没变（896 个）——重染不能把蓝线也吃掉', () => {
    let cyan = 0
    for (let p = 0; p < raw.length; p += 4) {
      const c = channels(p)
      if (c === null) continue
      if (c[3] > 200 && c[2] > 200 && c[0] < 120) cyan++
    }
    expect(cyan).toBe(896)
  })
})

describe('A 套配色：CSS 侧的板心', () => {
  const css = read('style.css')
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf('--on-fill')))
  const foods = css.slice(css.indexOf('.pet-plate.is-foods {'))
  const block = foods.slice(0, foods.indexOf('}'))

  it('四档填充都在同一条 H=232 阶梯上（改一档要一起改，别留半套）', () => {
    for (const [k, v] of [
      ['--plate-fill', '#ddeef8'],
      ['--hover-fill', '#cfe6f6'],
      ['--on-fill', '#a9d4ef'],
      ['--scroll-fill', '#607580'],
    ]) {
      expect(root, `${k} 不是 ${v}`).toContain(`${k}: ${v}`)
    }
  })

  it('板心走 CSS 的成对条件没散：slice 不带 fill + background-clip: padding-box', () => {
    // 少了 background-clip，浅蓝会铺进 border 区，素材圆角外侧的透明缺口处露出一圈方角色
    expect(block).toContain('background-color: var(--plate-fill)')
    expect(block).toContain('background-clip: padding-box')
    expect(block, 'slice 写成带 fill 就不该再有 background-clip 兜着').not.toMatch(/border-image:[^;]*fill/)
  })
})
