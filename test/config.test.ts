import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACTIVITY_FALLBACK, ACTIVITY_LABELS, AMBIENT_POOLS,
  CANVAS_W, CANVAS_H, FEET_Y, STAGE_W_CSS, STAGE_H_CSS,
  DEFAULT_BODY_BOX, REQUIRED_POOLS, PANEL_HIDE_MS, LEASE_TIMEOUT_MS,
  GRAB_HEARTBEAT_MS, BUBBLE_IMAGE, BUBBLE_W, BUBBLE_H, BUBBLE_INNER_BOTTOM,
  BUBBLE_CAVITY, BUBBLE_RING_W,
  FOOD_CELL, FOOD_ICON, FOOD_GAP, FOOD_VISIBLE, ONLINE_TICK_MS, VIEW_HIDE_MS,
  FLOAT_CHIP, FLOAT_MS, FLOAT_HEAD_OFFSET,
} from '../src/shared/config.js'
import { STAT_KEYS, STAT_TICK_MS } from '../src/shared/stats.js'
import { fitsLabel } from '../src/shared/text.js'
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

  /**
   * 格子里那张图的显示尺寸。图自己已经是归一化过的方图（`tools/make-food-icons.mjs` 里
   * FILL=0.86 留了内边距），所以 CSS 只定一个数；写歪 4px 就是六个东西看起来大小不一。
   */
  it('食物图标的显示尺寸 = FOOD_ICON，且格子里不再留字号（图替了字的位置）', () => {
    const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const icon = css.match(/\.pet-panel \.pet-food \.pet-food-icon \{([^}]*)\}/)?.[1] ?? ''
    expect(icon, '读不到 .pet-food-icon 那条').toContain(`width: ${FOOD_ICON}px`)
    expect(icon).toContain(`height: ${FOOD_ICON}px`)
    expect(FOOD_ICON, '图标大到顶到描边了（格子 48 减两条 1px 描边 = 46）').toBeLessThan(FOOD_CELL - 2)
    const cell = css.match(/\.pet-panel \.pet-food \{([^}]*)\}/)?.[1] ?? ''
    expect(cell, '格子里还留着 font-size：名字已经退成 title/aria-label 了').not.toMatch(/font-size/)
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

describe('飘字（属性涨了多少）的尺寸与时序', () => {
  // 先剥注释：这几条读的是 CSS 形状，注释里提一句属性名不该把自己判红（那条老规矩）
  const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const block = (sel: string): string => css.match(new RegExp(`\\.${sel} \\{([^}]*)\\}`))?.[1] ?? ''

  it('.pet-float 的宽高就是 FLOAT_CHIP：锚点按这个数算左右，写歪了字会压到宠物身上', () => {
    expect(block('pet-float'), '读不到 .pet-float 块').not.toBe('')
    expect(block('pet-float')).toContain(`width: ${FLOAT_CHIP.w}px`)
    expect(block('pet-float')).toContain(`height: ${FLOAT_CHIP.h}px`)
  })

  it('--float-ms 和 config 的 FLOAT_MS 是同一个数，且动画真的引用它', () => {
    expect(css).toMatch(new RegExp(`--float-ms: ${FLOAT_MS}ms`))
    expect(block('pet-float')).toContain('animation: pet-float-rise var(--float-ms')
  })

  it('上浮的距离不许超过 FLOAT_HEAD_OFFSET：再高就顶进气泡里了', () => {
    const rise = Number(css.match(/@keyframes pet-float-rise \{[\s\S]*?to \{[^}]*translateY\(-(\d+)px\)/)?.[1] ?? -1)
    expect(rise, '读不到 keyframes 的上浮距离').toBeGreaterThan(0)
    expect(rise).toBeLessThanOrEqual(FLOAT_HEAD_OFFSET)
  })

  it('四条数值各有各的墨色：少一条就红（加第五条数值忘了配色，会渲染成基类那支绿）', () => {
    for (const key of STAT_KEYS) {
      const rule = css.match(new RegExp(`\\.pet-float\\[data-key='${key}'\\] \\{([^}]*)\\}`))?.[1]
      expect(rule, `.pet-float[data-key='${key}'] 这条规则不在了`).toBeDefined()
      expect(rule).toMatch(new RegExp(`color: var\\(--gain-${key}\\)`))
    }
    // 四个色锁死。换色要连着跑一遍 `node spike/float-color.mjs`：
    // 它按白芯片压着近黑桌面混出来的最暗底（≈ #ededed）算对比度，四个都得 ≥4.5:1。
    const inks = Object.fromEntries([...css.matchAll(/--gain-(hunger|mood|weight|bond): (#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]))
    expect(inks).toEqual({ hunger: '#a04a00', mood: '#aa295f', weight: '#6938a7', bond: '#007840' })
    // 体重这支刻意从蓝色挪到紫：状态条那三档报警色里有一支蓝（#5aa0e6），
    // 同一屏里「蓝」不能一边表示「体重」一边表示「这条快满了」。
    expect(inks.weight).not.toBe('#3e5fad')
  })

  it('字号分档：饥饿最大、心情其次，体重与亲密度走基类那档 12px', () => {
    const size = (key: string): number | undefined => {
      const raw = css.match(new RegExp(`\\.pet-float\\[data-key='${key}'\\] \\{[^}]*font-size: (\\d+)px`))?.[1]
      return raw === undefined ? undefined : Number(raw)
    }
    expect(size('hunger'), '饥饿该是最大的一档').toBe(14)
    expect(size('mood')).toBe(13)
    expect(size('weight'), '体重不该单独加字号（它走基类 12px）').toBeUndefined()
    expect(size('bond'), '亲密度不该单独加字号（它走基类 12px）').toBeUndefined()
    expect(block('pet-float')).toMatch(/font: 600 12px\/1/)
    // 14px 那一档撑不撑得下 84 的盒子，由 e2e 按 data-key 实测（jsdom 没有排版引擎）
  })

  it('整层不吃鼠标，收起时真的移出布局（作者样式必须显式写 [hidden]）', () => {
    expect(block('pet-floats')).toContain('pointer-events: none')
    expect(css).toMatch(/\.pet-floats\[hidden\] \{[^}]*display: none/)
  })

  it('减少动效那档把动画整条关掉：清理归定时器，不靠 animationend', () => {
    // 文件里有好几处 @media (prefers-reduced-motion)（面板出场一条、飘字一条），要挑出飘字那条
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
      .map((m) => m[1] ?? '')
      .find((b) => b.includes('.pet-float'))
    expect(reduced, '找不到减少动效里关飘字动画的那条').toBeDefined()
    expect(reduced).toMatch(/animation: none/)
  })
})

/**
 * 相对亮度 → WCAG 对比度。样式里的色值都是 #rrggbb，够用。
 * 公式和 spike/color-math.mjs 的 relLum/contrast 一致——上一轮给飘字挑色用的就是它，
 * 两边算法不一样会出现「探针说够、单测说不够」这种更难查的分歧。
 */
function contrast(fg: string, bg: string): number {
  const lum = (hex: string): number => {
    const lin = (i: number): number => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5)
  }
  const a = lum(fg)
  const b = lum(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('状态栏的「此刻」两行与性别符号', () => {
  const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const genderBlock = (): string => css.match(/\.pet-plate\.is-stats \.pet-gender \{([^}]*)\}/)?.[1] ?? ''
  /** 从已经剥过注释的 CSS 里抠一个数；抠不到就是那条规则被人改了/删了，直接说人话报错。 */
  const pick = (re: RegExp, what: string): string => {
    const found = css.match(re)?.[1]
    if (found === undefined) throw new Error(`style.css 里读不到${what}`)
    return found
  }

  it('每个可能出现在屏幕上的池都有一句人话', () => {
    // current.pool 的取值范围 = 必需池 ∪ 环境池 ∪ eat（吃相）。漏一个就落到「正在发呆」，
    // 而「正在发呆」贴在一条正在嚼饭的宠物旁边就是 bug——所以这条按并集来查，不按手写清单。
    const pools = new Set<string>([...REQUIRED_POOLS, ...AMBIENT_POOLS, 'eat'])
    for (const pool of pools) expect(ACTIVITY_LABELS[pool], `池「${pool}」没有对应的状态说法`).toBeTruthy()
  })

  it('每一句都放得下值栏：状态栏那一列是所有行对齐的，顶宽了整栏歪', () => {
    const VALUE_MAX = (150 - 6 * 2 - 1 * 2 - 48 - 4) / 12
    for (const [pool, label] of Object.entries(ACTIVITY_LABELS)) {
      expect(fitsLabel(label, VALUE_MAX), `${pool} →「${label}」顶爆值栏`).toBe(true)
    }
    expect(fitsLabel(ACTIVITY_FALLBACK, VALUE_MAX)).toBe(true)
  })

  it('在线时间的节拍比数值 tick 快、且是 1 秒：再快没有可读变化，再慢那一档就不跳了', () => {
    expect(ONLINE_TICK_MS).toBe(1000)
    expect(ONLINE_TICK_MS).toBeLessThan(STAT_TICK_MS)
  })

  it('性别只剩符号：底色、描边、内边距都得是「没有」', () => {
    // 用户 2026-11-06 的原话「只要符号，不要背景」。这行不是观感偏好，是**语义**：
    // 那层淡底圈读起来像「一组里被选中的那一档」，而卡上只有这一枚，它没有对照组。
    const block = genderBlock()
    expect(block, '读不到 .pet-gender 块').not.toBe('')
    for (const prop of ['background: none', 'border: none', 'padding: 0']) {
      expect(block, `.pet-gender 还留着 ${prop}`).toContain(prop)
    }
  })

  it('底色去掉了，命中区还得撑到 24×24：那是卡上唯一能改存档的东西', () => {
    const num = (prop: string): number => Number(genderBlock().match(new RegExp(`${prop}: (\\d+)px`))?.[1] ?? 0)
    expect(num('min-width')).toBeGreaterThanOrEqual(24)
    expect(num('min-height')).toBeGreaterThanOrEqual(24)
  })

  it('符号的颜色在没有卡片垫底之后仍然够深（对副板底色 ≥4.5:1）', () => {
    // 原来 #e0559a 压在 rgba(255,255,255,.9) 那层卡片上才有 3.5:1；卡片一去它直接站在 --plate-fill 上，
    // 同一支只剩 2.98:1。这里两支都算一遍，别靠「看着挺清楚」过关。
    const plate = pick(/--plate-fill: (#[0-9a-f]{6})/, '--plate-fill')
    for (const g of ['female', 'male'] as const) {
      const ink = pick(
        new RegExp(`\\.pet-plate\\.is-stats \\.pet-gender\\.is-${g} \\{[^}]*color: (#[0-9a-f]{6})`),
        `雌雄里 ${g} 那一支`,
      )
      expect(contrast(ink, plate), `${g} 的 ${ink} 对副板 ${plate} 只有 ${contrast(ink, plate).toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
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

  it('文字与按钮都留在纯白内腔里（底边压在 BUBBLE_INNER_BOTTOM，四角不碰描边也不进圆角）', () => {
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
     * 内腔是**圆角矩形**（上一版是圆，再上一版是椭圆），所以分两步：
     * ① 从素材读 viewBox 与 stroke-width，钉住「显示比例 = 素材比例」和「环厚 = BUBBLE_RING_W」——
     *    这是素材与 config 之间唯一能机器核对的两条关系；素材换了形状而 config 没重算，这里就红。
     * ② 用 config 的 BUBBLE_CAVITY（内腔界，算法写在那条注释里）验内容块：
     *    先在矩形界内，再看有没有哪个角落进「两个方向都进了角区」的那块——那里要躲开圆弧。
     */
    const svg = readFileSync('src/renderer/emotes/bubble.svg', 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
    expect(vb, 'bubble.svg 读不到 viewBox').not.toBeNull()
    const [vbW, vbH] = [Number(vb![1]), Number(vb![2])]
    const stroke = Number(svg.match(/stroke-width="([\d.]+)"/)?.[1] ?? -1)
    expect(stroke, 'bubble.svg 读不到 stroke-width').toBeGreaterThan(0)
    const k = BUBBLE_W / vbW
    expect(vbH * k, `素材 ${vbW}×${vbH} 换算过来高 ${vbH * k}，和 BUBBLE_H=${BUBBLE_H} 不是同一个比例`).toBeCloseTo(BUBBLE_H, 1)
    // 用户两次点名「边框要细」：18.3 → 9.2 → 6。粗回去或细到发虚都会红。
    expect(stroke * k, `环厚 ${(stroke * k).toFixed(1)}px，和 BUBBLE_RING_W=${BUBBLE_RING_W} 对不上`).toBeCloseTo(BUBBLE_RING_W, 1)
    expect(BUBBLE_RING_W, '环厚低于 4px 在 2× 远程桌面上会开始发虚').toBeGreaterThanOrEqual(4)

    const cav = BUBBLE_CAVITY
    // 内容下界不许低过内腔底边（低过了就是字压到描边上），而且要有余量：留 14px 是这版的解。
    expect(BUBBLE_INNER_BOTTOM, `内容下界 ${BUBBLE_INNER_BOTTOM} 低过内腔底边 ${cav.y + cav.h}`).toBeLessThanOrEqual(cav.y + cav.h)
    expect(cav.y + cav.h - BUBBLE_INNER_BOTTOM, '下界离内腔底边太近，字会看着像要掉出去').toBeGreaterThanOrEqual(8)
    for (const sel of ['pet-bubble-text', 'pet-bubble-reply']) {
      const box = { x: px(sel, 'left'), y: px(sel, 'top'), w: px(sel, 'width'), h: px(sel, 'height') }
      expect(box.x, `${sel} 越过内腔左沿`).toBeGreaterThanOrEqual(cav.x)
      expect(box.y, `${sel} 越过内腔上沿`).toBeGreaterThanOrEqual(cav.y)
      expect(box.x + box.w, `${sel} 越过内腔右沿`).toBeLessThanOrEqual(cav.x + cav.w)
      expect(box.y + box.h, `${sel} 越过内腔下沿`).toBeLessThanOrEqual(cav.y + cav.h)
      const corners: [number, number][] = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
      for (const [x, y] of corners) {
        const fx = x < cav.x + cav.r ? cav.x + cav.r : x > cav.x + cav.w - cav.r ? cav.x + cav.w - cav.r : null
        const fy = y < cav.y + cav.r ? cav.y + cav.r : y > cav.y + cav.h - cav.r ? cav.y + cav.h - cav.r : null
        if (fx === null || fy === null) continue
        expect(Math.hypot(x - fx, y - fy), `(${x},${y}) 扎进圆角里了`).toBeLessThanOrEqual(cav.r)
      }
    }
  })
})
