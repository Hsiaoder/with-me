// 一次性配色研究：飘字芯片上四条数值各自的颜色/字号。跑完就删。
import { contrast, oklchToHex } from './color-math.mjs'

/** 芯片底是 rgba(255,255,255,.92)，压在桌面上。最暗的那种桌面（近黑）混出来是这个。 */
const chipDark = '#ededed'
const chipLight = '#ffffff'

/** 状态条已经在用的三档报警色——飘字要是再拿同一族色相表示「哪条数值」，一套颜色就有两副面孔。 */
const BANDS = { 蓝_高于60: '#2f6fbf', 黄_20到60: '#e6c15a', 红_低于20: '#e6572c' }

const CANDIDATES = {
  '饥饿 14px': [0.51, 0.14, 55, 14],
  '饥饿 14px-b': [0.47, 0.16, 32, 14],
  '心情 13px': [0.5, 0.17, 0, 13],
  '心情 13px-b': [0.5, 0.15, 335, 13],
  '体重 12px': [0.5, 0.13, 265, 12],
  '体重 12px-b': [0.48, 0.11, 232, 12],
  '亲密 11px': [0.5, 0.13, 155, 11],
  '亲密 11px-b': [0.48, 0.12, 175, 11],
}

const row = (name, hex, px) => {
  const onDark = contrast(hex, chipDark)
  const onLight = contrast(hex, chipLight)
  const gap = Math.min(...Object.entries(BANDS).map(([k, v]) => contrast(hex, v)))
  console.log(
    `${name.padEnd(14)} ${hex}  ${String(px) + 'px'}  对芯片暗 ${onDark.toFixed(2)}:1  对芯片亮 ${onLight.toFixed(2)}:1  ` +
      `${onDark >= 4.5 && onLight >= 4.5 ? 'AA过' : 'AA不过'}  离报警三档最近 ${gap.toFixed(2)}:1`,
  )
}
for (const [name, [l, c, h, px]] of Object.entries(CANDIDATES)) row(name, oklchToHex(l, c, h), px)
console.log('\n报警三档彼此：')
for (const [k, v] of Object.entries(BANDS)) console.log(`  ${k} ${v} 对芯片暗 ${contrast(v, chipDark).toFixed(2)}:1`)
