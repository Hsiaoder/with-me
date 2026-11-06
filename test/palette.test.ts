import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A 套「品牌蓝白」的素材不变量。
 *
 * 为什么要钉住：这枚圆底是从 Kenney 包里抄来再重染的，**换变体或重装素材会把原色盖回来**
 * （本仓库已经发生过一次：`button_round_line` → `button_round_depth_line` 时整套色都换了）。
 * 盖回来不会让任何功能测试变红——只是按钮又变回那枚灰紫硬币，得靠肉眼看。
 * 所以这里直接读文件本身：圆底看 fill 列表。
 *
 * 底板那张 PNG 已经退出产品（食物列表改用和状态读数同一张 CSS 卡片）；
 * 2026-11-06 换过一版手绘小鲸鱼当按钮底，用户在真机上看过说不好看，已改回圆底——
 * 鲸鱼那张素材随之删除，所以「不许还在」这一条换了主角（见 problem/05 §5.28）。
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

  it('按钮底只此一枚：手绘鲸鱼那张已经整个退出产品，文件不许还在', () => {
    // 留着就会被 copy-static 搬进 dist（这条规矩在食物底板上用过一次）
    expect(existsSync(resolve('src/renderer/icons/whale_round.svg')), '鲸鱼素材还留在仓库里').toBe(false)
  })
})

describe('A 套配色：CSS 侧的板心', () => {
  const css = read('style.css')
  // 切到 :root 那一块的收尾 `}`（行首那个），不是「第一个 }」：
  // 以前者写法的话，token 后面多加一行注释或再加一档就会把要查的那几格切掉（这条本轮踩过一次）
  const rootStart = css.indexOf(':root {')
  const root = css.slice(rootStart, css.indexOf('\n}', rootStart))

  it('五档填充都在同一条 H=232 阶梯上（改一档要一起改，别留半套）', () => {
    for (const [k, v] of [
      ['--plate-fill', '#ddeef8'],
      ['--hover-fill', '#cfe6f6'],
      ['--on-fill', '#a9d4ef'],
      ['--scroll-fill', '#607580'],
      // 气泡里那颗回应按钮。2026-11-06 从浅色那一格改成实心蓝：它是气泡里唯一的动作，
      // 浅面对白色内腔只有 1.57:1，和环也只差一档，读起来像「环的余料」（门槛见 style.css 那段）
      ['--reply-fill', '#007eb6'],
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
