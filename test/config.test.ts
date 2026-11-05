import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CANVAS_W, CANVAS_H, FEET_Y, STAGE_W_CSS, STAGE_H_CSS,
  DEFAULT_BODY_BOX, REQUIRED_POOLS, PANEL_HIDE_MS, LEASE_TIMEOUT_MS,
  GRAB_HEARTBEAT_MS, BUBBLE_IMAGE, BUBBLE_W, BUBBLE_H, BUBBLE_INNER_BOTTOM,
  FOOD_CELL, FOOD_GAP, FOOD_VISIBLE, VIEW_HIDE_MS,
} from '../src/shared/config.js'
import { mimeOf } from '../src/main/protocol.js'

describe('素材合同', () => {
  it('画布是 16:9', () => {
    expect(CANVAS_W / CANVAS_H).toBeCloseTo(16 / 9, 6)
  })
  it('舞台高度由宽度按 16:9 推导，不是第二个写死的数字', () => {
    expect(STAGE_H_CSS).toBeCloseTo((STAGE_W_CSS * 9) / 16, 6)
  })
  it('脚底基准线在画布内，且给底部留出落地余量', () => {
    expect(FEET_Y).toBeGreaterThan(0)
    expect(FEET_Y).toBeLessThan(CANVAS_H)
    expect(CANVAS_H - FEET_Y).toBeLessThan(CANVAS_H * 0.2)
  })
  it('默认身体框不越界', () => {
    expect(DEFAULT_BODY_BOX.x + DEFAULT_BODY_BOX.w).toBeLessThanOrEqual(CANVAS_W)
    expect(DEFAULT_BODY_BOX.y + DEFAULT_BODY_BOX.h).toBeLessThanOrEqual(CANVAS_H)
  })
})

describe('悬停与租约的时间关系', () => {
  it('租约超时必须大于光标间隔，否则正常续期也会被误判成卡死', () => {
    expect(LEASE_TIMEOUT_MS).toBeGreaterThan(33)
    // 心跳必须明显早于超时，否则手停在面板上不动时租约会先过期、鼠标被放开给桌面
    expect(GRAB_HEARTBEAT_MS).toBeLessThan(LEASE_TIMEOUT_MS)
    expect(LEASE_TIMEOUT_MS - GRAB_HEARTBEAT_MS).toBeGreaterThanOrEqual(GRAB_HEARTBEAT_MS)
  })
  it('收起延时不小于 2 个光标间隔，否则鼠标还没挪过去菜单就抽走了', () => {
    expect(PANEL_HIDE_MS).toBeGreaterThan(33 * 2)
  })
})

describe('皮肤必需池', () => {
  it('面板按钮覆盖的池都在必需池里（点了要有动画可播）', () => {
    for (const pool of ['idle', 'move', 'turn', 'click', 'drag']) {
      expect(REQUIRED_POOLS).toContain(pool)
    }
  })
})

describe('气泡素材', () => {
  it('.png 在 copy-static 的白名单里：文件在仓库里不等于进得了 dist，上一轮图标就是这么 404 的', () => {
    const src = readFileSync('tools/copy-static.mjs', 'utf8')
    const exts = [...src.matchAll(/'\.(html|css|svg|png|webm)'/g)].map((m) => m[1])
    expect(exts).toContain('png')
  })

  it('BUBBLE_IMAGE 指向的文件真的在仓库里', () => {
    expect(existsSync(join('src/renderer', BUBBLE_IMAGE))).toBe(true)
  })

  it('app:// 的 MIME 表认得 .png', () => {
    expect(mimeOf('a/b.png')).toBe('image/png')
  })
})

describe('食物列表的尺寸', () => {
  const css = readFileSync('src/renderer/style.css', 'utf8')
  /** 取某个选择器块里第一个 `width` / `height` 的字面量（px）。 */
  const dim = (sel: string, prop: 'width' | 'height'): string | undefined =>
    css.match(new RegExp(`\\.${sel}\\s*\\{[^}]*${prop}:\\s*(\\d+)px`))?.[1]

  it('一屏正好 4 格，视口宽 = 4×格 + 3×缝', () => {
    expect(FOOD_VISIBLE * FOOD_CELL + (FOOD_VISIBLE - 1) * FOOD_GAP).toBe(204)
  })

  it('CSS 里那四处尺寸字面量必须等于 config 常量——改格子只改一个数', () => {
    const VIEW_W = FOOD_VISIBLE * FOOD_CELL + (FOOD_VISIBLE - 1) * FOOD_GAP
    expect(dim('pet-food-viewport', 'width'), '视口宽 ≠ 视口数学').toBe(String(VIEW_W))
    expect(dim('pet-scroll', 'width'), '横条宽 ≠ 视口宽，thumbGeometry 会算错').toBe(String(VIEW_W))
    expect(dim('pet-food', 'height'), '格子高 ≠ FOOD_CELL').toBe(String(FOOD_CELL))
    expect(dim('pet-page', 'height'), '翻页键命中区该跟着格子高').toBe(String(FOOD_CELL))
  })

  it('底板投影不许溢出到上沿外（负 spread 是唯一防线）', () => {
    // 透明置顶窗里这层灰雾会直接压在桌面上：以前 `0 2px 8px` 时板顶外沿实测 alpha 12/255
    const m = css.match(/\.pet-plate\s*\{[^}]*box-shadow:\s*0\s+(\d+)px\s+(\d+)px\s+(-?\d+)px/)
    expect(m, '读不到 .pet-plate 的 box-shadow（写法变了？规则要求「0 Xpx Ypx -Zpx」）').not.toBeNull()
    const y = Number(m?.[1] ?? Number.NaN)
    const blur = Number(m?.[2] ?? Number.NaN)
    const spread = Number(m?.[3] ?? Number.NaN)
    expect(spread, 'spread 必须是负值才收得住上沿').toBeLessThan(0)
    expect(Math.abs(spread) + y, '模糊半径不得盖过「内收 + 下偏」').toBeGreaterThanOrEqual(blur / 2)
  })
})

describe('操作型视图共用宽裕的收起延时', () => {
  it('VIEW_HIDE_MS 是 5000，旧名字 SETTING_HIDE_MS 已经不存在', () => {
    expect(VIEW_HIDE_MS).toBe(5000)
    const src = readFileSync('src/shared/config.ts', 'utf8')
    expect(src).not.toContain('SETTING_HIDE_MS')
  })
})

describe('气泡尺寸', () => {
  it('config 的 BUBBLE_W/H 和 style.css 里那条 width/height 是同一个数', () => {
    // 照 CLIP_FADE_MS 那条老规矩：JS 算锚点用一份、CSS 排版用一份，改一处忘另一处
    // 就是「气泡位置对但内容被裁一半」这种查起来很费劲的错。
    const css = readFileSync('src/renderer/style.css', 'utf8')
    const body = css.match(/\.pet-bubble \{([^}]*)\}/)?.[1] ?? ''
    expect(body).toMatch(new RegExp(`width: ${BUBBLE_W}px`))
    expect(body).toMatch(new RegExp(`height: ${BUBBLE_H}px`))
  })

  it('Vector 底图不许邻取放大：抗锯齿的圆角会被拉成阶梯', () => {
    // 这条是反向的：Pixel 那版必须 pixelated，Vector 这版必须**别** pixelated。
    // 换素材时最容易忘的就是这一行，所以钉住——底图换了渲染方式就得跟着表过态。
    const css = readFileSync('src/renderer/style.css', 'utf8')
    expect(css.match(/\.pet-bubble-bg \{([^}]*)\}/)?.[1]).not.toMatch(/image-rendering:\s*pixelated/)
  })

  it('文字与按钮都留在纯白内腔里（描边那两行、尾巴那 30px 都不压字）', () => {
    const css = readFileSync('src/renderer/style.css', 'utf8')
    const block = (sel: string): string => css.match(new RegExp(`[.]${sel} [{]([^}]*)[}]`))?.[1] ?? ''
    const px = (sel: string, prop: string): number =>
      Number(new RegExp(`${prop}: (\\d+)px`).exec(block(sel))?.[1] ?? -1)

    for (const sel of ['pet-bubble-text', 'pet-bubble-reply']) {
      expect(px(sel, 'top'), `${sel} 的 top 没读到`).toBeGreaterThanOrEqual(0)
      expect(px(sel, 'height'), `${sel} 的 height 没读到`).toBeGreaterThan(0)
    }
    expect(px('pet-bubble-text', 'top') + px('pet-bubble-text', 'height')).toBeLessThanOrEqual(BUBBLE_INNER_BOTTOM)
    expect(px('pet-bubble-reply', 'top') + px('pet-bubble-reply', 'height')).toBeLessThanOrEqual(BUBBLE_INNER_BOTTOM)
    // 反证：数没读到就是 -1，上面两条会直接红，不会出现"读不到也算通过"
    expect(px('pet-bubble-nosuch', 'top')).toBe(-1)
  })
})
