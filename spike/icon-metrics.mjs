/**
 * 一次性量具：把五枚图标画到 canvas 上读**实际墨迹范围**，而不是信 viewBox。
 * 为什么要量：iconfont 那几张的内部留白各不相同，强制同一个 26×26 方框时，
 * 墨迹顶到方框四角的（筷子和齿轮齿）会戳出圆底的青圈——圆是圆，方是方，
 * 半对角 = 半边长 × 1.414，这个差值只能量出来，坐在代码前想不出来。
 * 跑法：node spike/icon-metrics.mjs
 */
import { _electron as electron } from 'playwright'
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ICONS = [
  'icons/rice.svg', 'icons/game.svg', 'icons/heart.svg', 'icons/settings.svg', 'emotes/dots3.png',
  'icons/button_round_depth_line.svg',
]
const S = 512

// 量具只需要一个空白页：图全部走 canvas，不进 DOM 布局（DOM 尺寸会掺进缩放误差）
mkdirSync('spike/out', { recursive: true })
writeFileSync(resolve('spike/out/_metrics.html'), '<!doctype html><meta charset="utf-8"><title>metrics</title>')

const app = await electron.launch({
  args: ['spike/preview-main.cjs'],
  env: { ...process.env, PREVIEW_URL: pathToFileURL(resolve('spike/out/_metrics.html')).href },
})
try {
  const page = await app.firstWindow()
  const rows = []
  for (const icon of ICONS) {
    const r = await page.evaluate(async ({ src, S }) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const c = document.createElement('canvas')
      c.width = S
      c.height = S
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, 0, 0, S, S)
      const d = g.getImageData(0, 0, S, S).data
      let x0 = S, y0 = S, x1 = 0, y1 = 0, ink = 0
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const a = d[(y * S + x) * 4 + 3]
          if (a > 24) {
            ink++
            if (x < x0) x0 = x
            if (y < y0) y0 = y
            if (x > x1) x1 = x
            if (y > y1) y1 = y
          }
        }
      }
      const w = x1 - x0 + 1
      const h = y1 - y0 + 1
      // 墨迹中心相对方框中心的偏移：偏移大就说明「居中」是骗人的，得按视觉重心挪
      const cx = (x0 + x1) / 2 - S / 2
      const cy = (y0 + y1) / 2 - S / 2
      return {
        natural: `${img.naturalWidth}x${img.naturalHeight}`,
        box: `${(w / S).toFixed(3)}x${(h / S).toFixed(3)} 方框占比`,
        off: `偏移 ${((cx / S) * 100).toFixed(1)}%, ${((cy / S) * 100).toFixed(1)}%`,
        // 最远墨迹点到中心的距离（半径），和青圈半径比才知道有没有戳出去
        maxR: (Math.hypot(Math.max(x1 - S / 2, S / 2 - x0), Math.max(y1 - S / 2, S / 2 - y0)) / (S / 2)).toFixed(3),
        ink: (ink / (S * S) * 100).toFixed(1) + '%',
      }
    }, { src: pathToFileURL(resolve('src/renderer', icon)).href, S })
    rows.push({ icon, ...r })
  }
  console.table(rows)
} finally {
  await app.close()
}
