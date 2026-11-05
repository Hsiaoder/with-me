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

describe('面板出场动画的形状约束', () => {
  // 一律先剥注释：这类「读 CSS 形状」的断言把注释算进去，注释里提一句属性名就把自己判红（真发生过两次）
  const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const starting = [...css.matchAll(/@starting-style\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '')

  it('有出场起始态：scale + translate，且绝不碰 transform', () => {
    expect(starting.length, '一个 @starting-style 块都没读到').toBeGreaterThan(0)
    const enter = starting.find((b) => b.includes('scale: var(--enter-scale)'))
    expect(enter, '出场起始态该用独立的 scale 属性').toBeDefined()
    // transform 是 place() 每帧写的定位，按钮悬停也占着它——动画抢这个属性会把两块摆歪
    for (const block of starting) {
      expect(block, '@starting-style 里出现了 transform，会和定位打架').not.toMatch(/[^-]transform:/)
    }
  })

  it('两条「别动」出口都在：系统减少动效 + data-no-motion（e2e 用它关掉再量几何）', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/\[data-no-motion\]/)
    // 出口是把旋钮拧回中性值，不是删规则——所以两处都得同时归零 scale 与错峰
    for (const sel of ['@media (prefers-reduced-motion: reduce)', '[data-no-motion]']) {
      const block = css.slice(css.indexOf(sel))
      expect(block, `${sel} 该把 --enter-scale 拧回 1`).toMatch(/--enter-scale: 1/)
      expect(block, `${sel} 该把错峰归零`).toMatch(/--stagger: 0ms/)
    }
  })

  it('悬停规则不再自带 transition 简写：那会把出场的 scale/translate 整个清掉', () => {
    const hover = css.match(/\.pet-panel button\[data-id\]:hover \{([^}]*)\}/)?.[1] ?? ''
    expect(hover).toContain('transform: scale(1.15)')
    expect(hover, 'transition 该写在基类那条里，和出场的几条合并声明').not.toContain('transition')
    expect(css.match(/\.pet-panel button\[data-id\] \{([^}]*)\}/)?.[1]).toContain('transition: transform 0.12s ease, scale')
  })
})

describe('选中态的声明方式', () => {
  const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  /**
   * 真踩过：`.pet-panel button.on { background: var(--on-fill) }` 这条同时管着文字卡片和五颗圆底，
   * 而圆底就是按钮的 `background-image`——`background` 简写会把图擦成 none，
   * 40×40 的命中区当场露成正方形。用户报的原话是「喂食的按钮怎么变成正方形了」。
   * 所以：`.on` 的底色只能走 `background-color` / `background-image` 长写法，
   * 而且带简写的那条必须限定在 `.pet-plate`（卡片都在板里，圆底都在 `.pet-actions`）。
   */
  it('任何 .on 规则都不许用 background 简写，除非它限定在 .pet-plate 里', () => {
    const rules = [...css.matchAll(/([^{}]*\.on[^{}]*)\{([^}]*)\}/g)]
    expect(rules.length, '一条 .on 规则都没读到，选择器改名了？').toBeGreaterThan(0)
    for (const m of rules) {
      const sel = (m[1] ?? '').trim()
      const body = m[2] ?? ''
      if (!/background:/.test(body)) continue
      expect(sel, `「${sel}」用 background 简写会擦掉圆底图`).toContain('.pet-plate')
    }
  })

  it('圆底没有视觉选中态，副板不参与出场动画（两条都是拍板，不是遗漏）', () => {
    // ① 描边环试过，用户说「不要出现外面的一个黑圈」——所以圆底上不许再有 outline / background
    const disc = css.match(/\.pet-actions button\[data-id\][^{]*\.on[^{]*\{([^}]*)\}/)?.[1]
    expect(disc, '圆底又被加了视觉选中态（用户明确不要那圈黑环）').toBeUndefined()
    // ② 副板直接出现：基类不许有 scale/translate 过渡，也不许进 @starting-style
    const plate = css.match(/\.pet-plate \{([^}]*)\}/)?.[1] ?? ''
    expect(plate, '副板被加回了胀开动画').not.toMatch(/transition:[^;]*(scale|translate)/)
    const enter = [...css.matchAll(/@starting-style\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '')
    expect(enter.length, '一个 @starting-style 块都没读到').toBe(3)   // 根淡入 / 按钮出场 / 气泡淡入
    for (const block of enter) {
      expect(block, '副板又进了 @starting-style').not.toContain('pet-plate')
    }
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

  it('气泡底图是矢量，且不许邻取放大：抗锯齿的圆角会被拉成阶梯', () => {
    // 上一版是 Kenney Vector PNG 放大 5 倍，描边被二次采样摊开约 4.5 CSS px（spike/bubble-edge-ab.mjs 量的），
    // 现在换成同轮廓的 SVG。两件事必须一起成立：底图是 .svg，且 `.pet-bubble-bg` 里没有 pixelated。
    // 哪天要换回位图，这两行都得重新表过态。
    expect(BUBBLE_IMAGE.endsWith('.svg'), `底图又退回位图了：${BUBBLE_IMAGE}`).toBe(true)
    // 先剥注释：这条断言读的是 CSS 形状，注释里提一句那个属性名不该把自己判红（真发生过）
    const code = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code.match(/\.pet-bubble-bg \{([^}]*)\}/)?.[1]).not.toMatch(/image-rendering:\s*pixelated/)
  })

  it('文字与按钮都留在纯白内腔里（底边压在 BUBBLE_INNER_BOTTOM，四角落在内腔圆内）', () => {
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

    /**
     * 内腔是**圆**，不是矩形——只验底边会放过「四角戳到描边上」那种错。
     * 圆心与半径都从素材里算出来，不在测试里抄一份数字（抄了就是第二本账，素材改了测试还绿着）：
     * bubble.svg 是一条**中线**轮廓 + 描边，所以
     *   中线半径 = 路径里那条 `A r r` 的 r，环厚 = stroke-width，
     *   内腔半径 = 中线半径 − 环厚/2，
     *   圆心 = 路径起点（中线圆的最高点）往下挪一个中线半径。
     * 尾巴在正下方，所以圆心**不在框正中**——这正是这条算式存在的理由。
     */
    const svg = readFileSync('src/renderer/emotes/bubble.svg', 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
    expect(vb, 'bubble.svg 读不到 viewBox').not.toBeNull()
    const [vbW, vbH] = [Number(vb![1]), Number(vb![2])]
    expect(vbW, '这条算式按正方框写的').toBe(vbH)
    const midR = Number(svg.match(/A([\d.]+) [\d.]+ 0 0 1/)?.[1] ?? -1)
    const band = Number(svg.match(/stroke-width="([\d.]+)"/)?.[1] ?? -1)
    const start = /M([\d.]+) ([\d.]+)/.exec(svg)
    expect(midR, 'bubble.svg 读不到中线弧半径').toBeGreaterThan(0)
    expect(band, 'bubble.svg 读不到 stroke-width').toBeGreaterThan(0)
    expect(start, 'bubble.svg 读不到路径起点').not.toBeNull()
    const k = BUBBLE_W / vbW
    const cavityR = (midR - band / 2) * k
    const cx = Number(start![1]) * k
    const cy = (Number(start![2]) + midR) * k
    // 用户点名「边框要设置的细一点」：环厚按原图比例只有 9.2 CSS px，
    // 上一版（iconfont 那支）是 18.3。这条钉住别哪天手滑又画粗回去。
    expect(band * k, `环厚 ${band * k}px，比 12px 还粗就不叫细了`).toBeLessThanOrEqual(12)
    for (const sel of ['pet-bubble-text', 'pet-bubble-reply']) {
      const box = { x: px(sel, 'left'), y: px(sel, 'top'), w: px(sel, 'width'), h: px(sel, 'height') }
      const corners: [number, number][] = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
      const worst = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)))
      expect(worst, `${sel} 的角点离圆心 ${worst.toFixed(1)}，内腔半径只有 ${cavityR.toFixed(1)}`).toBeLessThan(cavityR)
    }
  })
})
