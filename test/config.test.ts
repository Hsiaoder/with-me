import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  ACTIVITY_FALLBACK, ACTIVITY_LABELS, AMBIENT_POOLS,
  CANVAS_W, CANVAS_H, FEET_Y, STAGE_W_CSS, STAGE_H_CSS,
  DEFAULT_BODY_BOX, REQUIRED_POOLS, PANEL_HIDE_MS, LEASE_TIMEOUT_MS,
  GRAB_HEARTBEAT_MS, BUBBLE_IMAGE, BUBBLE_W, BUBBLE_H, BUBBLE_INNER_BOTTOM,
  BUBBLE_RING_W,
  FOOD_CELL, FOOD_ICON, FOOD_GAP, FOOD_VISIBLE, GAME_CELL, GAME_ICON, GAME_GAP, ONLINE_TICK_MS, VIEW_HIDE_MS,
  FLOAT_CHIP, FLOAT_MS, FLOAT_HEAD_OFFSET,
} from '../src/shared/config.js'
import { CLOUD, cloudCircles, cloudScale, fitsInsideCloud } from '../src/shared/bubble-shape.js'
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

  it('游戏列表和食物列表同一套格子量级：CSS 字面量 = GAME_CELL / GAME_ICON', () => {
    const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const cell = css.match(/\.pet-panel button\.pet-game \{([^}]*)\}/)?.[1] ?? ''
    expect(cell, '游戏格子高 ≠ GAME_CELL，和食物格子就不是一套了').toContain(`height: ${GAME_CELL}px`)
    expect(cell).toContain(`width: ${GAME_CELL}px`)
    expect(GAME_GAP, '游戏格间距该和食物一致').toBe(FOOD_GAP)
    const icon = css.match(/\.pet-panel \.pet-game \.pet-game-icon \{([^}]*)\}/)?.[1] ?? ''
    expect(icon, '读不到 .pet-game-icon 那条').toContain(`width: ${GAME_ICON}px`)
    expect(GAME_ICON, '图标大到顶到描边了').toBeLessThan(GAME_CELL - 2)
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

  it('飘字统一 Fredoka 14px：四条不再分档字号，只认颜色（2026-11-07 用户拍板「数字 Fredoka 14px」）', () => {
    for (const key of STAT_KEYS) {
      const rule = css.match(new RegExp(`\\.pet-float\\[data-key='${key}'\\] \\{([^}]*)\\}`))?.[1]
      expect(rule, `.pet-float[data-key='${key}'] 这条规则不在了`).toBeDefined()
      expect(rule, '分档字号已撤，per-key 不该再写 font-size').not.toMatch(/font-size/)
    }
    expect(block('pet-float')).toMatch(/font: 400 14px\/1 var\(--font-num\)/)
    // 14px 撑不撑得下 84 的盒子，由 e2e 按 data-key 实测（jsdom 没有排版引擎）
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
    // 值栏可用宽度 = 卡宽 150 − 内边距 6×2 − 描边 1×2 − 标签「状态：」36 − 间距 4 = 96px → 8 个汉字宽
    // （标签宽度按 12px 字号一个汉字一档，全角冒号和汉字同宽，见 text.ts 的 WIDE）
    const VALUE_MAX = (150 - 6 * 2 - 1 * 2 - 36 - 4) / 12
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

  it('三行「它是谁」值紧跟冒号，其余行仍右对齐到数值那一栏', () => {
    // 两种对齐各有理由（见 style.css 那两条注释），所以这里钉的是「只有 is-tight 那档紧」：
    // 有人把 justify-content 统一回 space-between 或全改成 flex-start，这条都会红。
    /**
     * 选择器组里最后一个选择器**自己占一行**（`.pet-stat,` 换行 `.pet-stat-line {`），
     * 所以 `^\.pet-stat-line \{` 会同时命中那条共用块和这条单独块——第一次就误读了共用块，
     * 报「读不到 justify-content」。改成在所有同名块里找**声明了 justify-content 的那一条**：
     * 真被删了它就是空串，断言照样红，不会退化成「读不到也算过」。
     */
    const blocks = [...css.matchAll(/^\.pet-stat-line \{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    const base = blocks.find((b) => b.includes('justify-content')) ?? ''
    const tight = css.match(/^\.pet-stat-line\.is-tight \{([^}]*)\}/m)?.[1]
    expect(blocks.length, '一条 .pet-stat-line 规则都读不到').toBeGreaterThan(0)
    expect(base, '没有哪条 .pet-stat-line 声明了 justify-content').toContain('justify-content: space-between')
    expect(tight, '少了 .pet-stat-line.is-tight 那条').toBeDefined()
    expect(tight).toContain('justify-content: flex-start')
  })

  it('符号靠左起笔：和「小鲸」「Lv.2」同一列，而不是缩在 24px 命中区的右端', () => {
    // 用户 2026-11-07：「性别的符号往左边一点，和名字和等级的值居中对齐」。
    // 三行都是 is-tight（值紧跟冒号），所以值的起笔就是标签后面那一格；
    // flex-end 会让 ♀ 再多挪半格，同一列就断了。命中区仍是 24×24，只有符号在格子里靠左。
    expect(genderBlock()).toContain('justify-content: flex-start')
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

describe('覆盖层不许被选中', () => {
  const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const root = css.match(/^html,\s*body \{([^}]*)\}/m)?.[1] ?? ''

  it('html,body 那条里有 user-select: none（双击宠物不该画出选区灰底）', () => {
    // 成因与现象记在 problem/05 §5.34；e2e 那条走真实鼠标双击，这条钉样式本身——
    // 少了这条，有人「整理 CSS」时把它删了，e2e 也只会说「今天没选中」，查不到是谁动的。
    expect(root, '读不到 html,body 那条规则').not.toBe('')
    expect(root).toContain('user-select: none')
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

  it('bubble.svg 是清单的生成物：改了清单没重新生成，这条就红', () => {
    // 上一版最难查的错就是这个：素材手写一份、config 的注释里再算一份、测试只读得到其中两个数。
    // 形状与几何现在只有 `bubble-shape.ts` 一处，跑 --check 比对，不写文件。
    expect(() => execFileSync('node', ['tools/make-bubble-svg.mjs', '--check'], { stdio: 'pipe' })).not.toThrow()
  })

  it('文字与回应按钮都落在云朵的白色内腔里（四角 + 四边中点，再缩进 12 单位）', () => {
    const css = readFileSync('src/renderer/style.css', 'utf8')
    const block = (sel: string): string => css.match(new RegExp(`[.]${sel} [{]([^}]*)[}]`))?.[1] ?? ''
    const px = (sel: string, prop: string): number =>
      Number(new RegExp(`${prop}: (\\d+)px`).exec(block(sel))?.[1] ?? -1)

    /**
     * 判据是 `fitsInsideCloud`（把每个图元收进 pad 单位，再问八个点还在不在并集里），
     * 不再是「一个内腔矩形 + 四角躲圆角」——云朵上下不对称，顶上三朵包之间的凹缝
     * 正好能从内容块**边的中段**咬进来一口，只看四角会漏判。
     * pad = 12 单位（6 CSS px）是「字别压在描边上」那条观感要求的量化。
     */
    const k = cloudScale(CLOUD, BUBBLE_W)
    for (const sel of ['pet-bubble-text', 'pet-bubble-reply']) {
      expect(px(sel, 'top'), `${sel} 的 top 没读到`).toBeGreaterThanOrEqual(0)
      expect(px(sel, 'height'), `${sel} 的 height 没读到`).toBeGreaterThan(0)
      const box = { x: px(sel, 'left') / k, y: px(sel, 'top') / k, w: px(sel, 'width') / k, h: px(sel, 'height') / k }
      expect(fitsInsideCloud(CLOUD, box, 12), `${sel} 越出云朵的白色内腔了`).toBe(true)
    }
    // 回应按钮的底边就是 BUBBLE_INNER_BOTTOM（注释与装配读的是同一个数，不许两份账）
    expect(px('pet-bubble-reply', 'top') + px('pet-bubble-reply', 'height')).toBe(BUBBLE_INNER_BOTTOM)
    // 反证：数没读到就是 -1，上面几条会直接红，不会出现"读不到也算通过"
    expect(px('pet-bubble-nosuch', 'top')).toBe(-1)
  })

  it('显示高与环厚都从清单推出来，不是第二个写死的数', () => {
    const k = cloudScale(CLOUD, BUBBLE_W)
    expect(BUBBLE_H, '高度不是按清单比例推的').toBeCloseTo(CLOUD.vb.h * k, 6)
    expect(BUBBLE_RING_W, '环厚和清单的 ring 对不上').toBeCloseTo(CLOUD.ring * k, 6)
    // 用户两次点名「边框要细」：18.3 → 9.2 → 6。粗回去、或细到 2× 远程桌面上发虚，都会红。
    expect(BUBBLE_RING_W).toBeGreaterThanOrEqual(4)
    expect(BUBBLE_RING_W, '环又画回粗的了').toBeLessThanOrEqual(7)
  })

  it('底边是一条直线：底边云包必须为空，尾巴仍是最低的墨迹', () => {
    // 用户 2026-11-06 看完真机点名「云的下边缘改成直的，红框框起来的变成一条直线」。
    // 上一轮才按「下面也变成云朵形状」加上两朵，所以这条是**防止它自己又长回来**的桩。
    expect(CLOUD.foots, '底边又鼓出云包了').toEqual([])
    // 尾巴还在：底边拉直后它是画布里最低的那一个，画布高度才是 376 而不是身子的 330。
    const lowest = Math.max(...cloudCircles(CLOUD).map((c) => c.y + c.r))
    expect(lowest, '尾巴不再是最低点（气泡就不指着宠物了）').toBe(364)
    expect(CLOUD.vb.h, '画布下沿和「尾巴含环」对不上').toBe(lowest + CLOUD.ring)
  })
})

describe('气泡的两支颜色：淡蓝环（用户拍板，明度过不了 3:1）+ 圆底面那块淡蓝', () => {
  const svg = readFileSync('src/renderer/emotes/bubble.svg', 'utf8')
  const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  /** 素材里两层同形状：先画的带色那层 = 环，后画的白层 = 内腔。 */
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => (m[1] ?? '').toLowerCase())
  const ring = fills[0] ?? ''
  const cavity = fills[1] ?? ''
  const reply = css.match(/--reply-fill: (#[0-9a-f]{6})/)?.[1] ?? ''
  const pick = (re: RegExp, what: string): string => {
    const found = css.match(re)?.[1]
    if (found === undefined) throw new Error(`style.css 里读不到${what}`)
    return found.toLowerCase()
  }
  const pill = pick(/\.pet-bubble-reply \{[^}]*border: 1px solid (#[0-9a-f]{6})/, '那颗按钮的描边色')
  const ink = pick(/\.pet-bubble-reply \{[^}]*color: (#[0-9a-f]{6})/, '那颗按钮的文字色')
  const hue = (h: string): number => {
    const m = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    const A = 1.9779984951 * m[0]! - 2.428592205 * m[1]! + 0.4505937099 * m[2]!
    const B = 0.0259040371 * m[0]! + 0.7827717662 * m[1]! - 0.808675766 * m[2]!
    return (Math.atan2(B, A) * 180) / Math.PI
  }

  it('环钉在 #92C7E3：这支是用户看过四轮之后挑的淡蓝，不是谁顺手调浅的', () => {
    expect(ring, 'bubble.svg 第一层不是那支淡蓝环').toBe('#92c7e3')
    expect(cavity, '内腔不是纯白就没法当对比度的底').toBe('#ffffff')
    /**
     * 这里**故意不写 `≥ 3`**。实测这支对白内腔 1.83、对浅桌面 1.61，不达 UI 组件的 3:1——
     * 浅壁纸上气泡边缘会化开，那正是第二轮换成 #5492B2 的理由（`spike/bubble-color.mjs` 有算式）。
     * 2026-11-07 用户看过淡的、深的、角色色、青蓝四轮之后说「最开始的环是淡蓝，改回去吧」：
     * **观感优先于门槛**，这是他的决定，不是我们算错了。
     * 所以这条钉的是「别有人拿 3:1 把它悄悄调深」——要调深请重新问用户，不要动测试。
     * 补偿手段是 CSS 那层 `drop-shadow`（跟着 alpha 走），它才是浅壁纸上真正分出水泡的东西。
     */
    expect(contrast(ring, cavity), '环比当年更浅了，连投影都救不回来').toBeGreaterThan(1.5)
  })

  it('按钮面 = 动作按钮那层圆底面；边界由描边扛，文字仍是墨色', () => {
    expect(reply, '--reply-fill 不是圆底面那一支淡蓝').toBe('#ebf5fb')
    expect(contrast(ink, reply), `墨字对按钮面只有 ${contrast(ink, reply).toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    // 这块面对白内腔只有 1.11:1，压不住白色气泡——所以组件边界量的是**描边**。
    // 写成 toBeLessThan 是故意的：哪天有人把面调深到能自己扛，这条会逼他重看描边还要不要。
    expect(contrast(reply, cavity), '淡面自己就压得住白内腔？判据要重看').toBeLessThan(3)
    expect(contrast(pill, cavity), `描边对白内腔只有 ${contrast(pill, cavity).toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    // 边和面是同一个组件的两层，不要求 3:1；但得**分得开**，否则边等于没画
    expect(contrast(pill, reply), `描边和按钮面差 ${contrast(pill, reply).toFixed(2)}，边画了等于没画`).toBeGreaterThanOrEqual(2)
    // 边和环该在同一条 H≈232 上：淡蓝家族里混进一支别的蓝就变成「配色」了。
    // 按钮面不参与比色相——C=0.013 的近中性色，色相跟着噪点飘，比它没意义。
    expect(Math.abs(hue(pill) - hue(ring)), `描边 ${pill} 偏离环 ${ring} 那条色相`).toBeLessThan(12)
  })
})
