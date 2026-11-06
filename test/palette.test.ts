import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A 套「品牌蓝白」的素材不变量。
 *
 * 为什么要钉住：按钮底这枚形状是**我们自己画的**（2026-11-06 从小鲸鱼那版起），
 * 但它用的还是 A 套那两档色；而历史上这里栽过一次——圆底从 Kenney 的一个变体换成另一个变体时
 * 整套原色被盖回来，**任何功能测试都不会红**，只是按钮又变回那枚灰紫硬币，得靠肉眼看。
 * 所以这里直接读文件本身：看 fill / stroke 列表。
 *
 * 底板那张 PNG 已经退出产品（食物列表改用和状态读数同一张 CSS 卡片），
 * 圆底也退出了（换成鲸鱼，投影改由 CSS 的 drop-shadow 给）；
 * 重染的算法与门槛在 spike/palette-recolor.mjs 与 spike/color-math.mjs。
 */
const A = {
  面: '#ebf5fb',
  环: '#6990a7',
}
/** 素材原色：中性偏紫的灰，重染后一个都不该留 */
const STALE = ['#9696A3', '#747487', '#DADCE7']

const read = (rel: string) => readFileSync(resolve('src/renderer', rel), 'utf8')

describe('A 套配色：鲸鱼按钮底', () => {
  const svg = read('icons/whale_round.svg')
  const fills = [...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => (m[1] ?? '').toLowerCase())
  const strokes = [...svg.matchAll(/stroke="(#[0-9A-Fa-f]{6})"/g)].map((m) => (m[1] ?? '').toLowerCase())

  it('面与环两档都在，别的颜色一个不多', () => {
    expect(fills, `面不在里面：${fills.join(',')}`).toContain(A.面)
    expect(strokes, `环不在里面：${strokes.join(',')}`).toContain(A.环)
    // 投影不画进素材（画了就换不了尺寸、也关不掉），所以素材里不该出现任何灰/黑
    for (const c of [...fills, ...strokes]) {
      expect(c, `素材里混进了一个非 A 套的色 ${c}`).toMatch(/^(#ebf5fb|#6990a7)$/)
    }
  })

  it('素材原色（灰紫那三档）一个都不剩', () => {
    for (const stale of STALE) {
      expect(svg.toLowerCase(), `还留着 ${stale}`).not.toContain(stale.toLowerCase())
    }
  })

  it('边框是「同形两层」画的，不是单条描边：两层形状必须一模一样', () => {
    /**
     * 下层「填 + 描同色宽边」胀出轮廓，上层只填色盖回内腔——这样并集外沿的环厚处处一致，
     * 交界处也不会多出横线（云朵气泡那条同一个做法，见 problem/03 §3.8）。
     * 两层要是各画各的形状，缝就露出来了，而且这种错**只在放大看才看得出来**。
     */
    const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
    expect(paths, '读不到路径').toHaveLength(2)
    expect(paths![0], '两层的形状不一致').toBe(paths![1])
    const w = Number(svg.match(/stroke-width="([\d.]+)"/)?.[1] ?? -1)
    expect(w, '读不到描边宽度').toBeGreaterThan(0)
    // 描边宽 = 环厚的两倍（描线压在轮廓上，一半朝内一半朝外）
    expect(w / 2, '环厚和描边宽不成对').toBe(6)
  })

  it('旧的 Kenney 圆底已经整个退出产品：文件不许还在', () => {
    // 留着就会被 copy-static 搬进 dist（这条规矩在食物底板上用过一次）
    expect(existsSync(resolve('src/renderer/icons/button_round_depth_line.svg')), '圆底素材还留在仓库里').toBe(false)
  })
})

describe('A 套配色：CSS 侧的板心', () => {
  const css = read('style.css')
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf('--on-fill')))

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

  it('副板一块素材边框都不要：谁把 border-image 加回来，这条就红', () => {
    // 用户 2026-11-06 的拍板是「列表也做成简单卡片」，理由写在 style.css 那段注释里。
    // 真要加回来不是不行，但那是另一个决定，得连带把 slice 不对称、background-clip 那套一起捡回来
    // （见 problem/03 §3.9），不该顺手发生。
    // 匹配前先剥掉注释：这类「读 CSS 形状」的断言要是把注释也算进去，
    // 注释里提一句属性名就会把自己判红（同一件事已经发生两次了）。
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code, 'CSS 里又出现 border-image 九宫格').not.toMatch(/border-image/)
    // 素材留在仓库里就会被 copy-static 搬进 dist 一起发出去，所以它是删掉的、不是「没人引用」
    expect(existsSync(resolve('src/renderer', 'icons', 'button_rectangle_depth_line.png')), '底板素材又回到仓库了').toBe(false)
  })
})
