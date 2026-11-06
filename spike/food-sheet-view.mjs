/**
 * 一次性验收：六张食物图标抠得对不对、缩到 48 格长什么样。跑完就删。
 * 底衬故意用中灰——白饭/饺子要是被抠出洞，或描边外留了一圈白晕，在灰底上藏不住。
 * 用法：node spike/food-sheet-view.mjs
 */
import { _electron as electron } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ids = ['token', 'rice', 'tanghulu', 'crab', 'hotpot', 'dumpling']
const names = { token: '代币', rice: '白饭', tanghulu: '糖葫芦', crab: '大闸蟹', hotpot: '火锅', dumpling: '饺子' }
const data = ids.map((id) => ({ id, name: names[id], url: 'data:image/png;base64,' + readFileSync(join('src/renderer/foods', `${id}.png`)).toString('base64') }))

const userData = join(tmpdir(), 'pet-food-view-')
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: userData, PET_FREEZE_CURSOR: '1' },
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
  const stats = await page.evaluate(async (items) => {
    document.body.innerHTML = ''
    document.body.style.cssText = 'margin:0;background:#7a7a7a;padding:14px;display:flex;gap:12px;flex-wrap:wrap;font:12px sans-serif'
    const out = []
    for (const it of items) {
      const bmp = await createImageBitmap(await (await fetch(it.url)).blob())
      // alpha 统计：全透明 / 半透明 / 不透明各多少，看有没有被抠穿
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(bmp, 0, 0)
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data
      let clear = 0, semi = 0, solid = 0, edge = 0
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] === 0) clear++; else if (d[i] < 250) semi++; else solid++
      }
      // 描边外第一圈有没有「白而不透明」的像素（白晕）：统计不透明且近白的数量
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 250 && d[i] >= 246 && d[i + 1] >= 246 && d[i + 2] >= 244) edge++
      }
      out.push({ id: it.id, size: `${bmp.width}x${bmp.height}`, clear, semi, solid, whiteish: edge })

      const box = document.createElement('div')
      box.style.cssText = 'color:#fff;text-align:center'
      box.innerHTML = `<div style="width:128px;height:128px;background:#7a7a7a"></div>
        <div style="width:48px;height:48px;margin:6px auto 0;background:rgba(255,255,255,.94);border-radius:8px;display:flex;align-items:center;justify-content:center"></div>
        <div style="margin-top:4px">${it.name}</div>`
      const big = document.createElement('img')
      big.src = it.url
      big.width = 128
      big.height = 128
      box.children[0].append(big)
      const small = document.createElement('img')
      small.src = it.url
      small.width = 40
      small.height = 40
      box.children[1].append(small)
      document.body.append(box)
    }
    await new Promise((r) => setTimeout(r, 400))
    return out
  }, data)
  for (const s of stats) {
    const total = s.clear + s.semi + s.solid
    console.log(`${s.id.padEnd(9)} ${s.size}  透明 ${(100 * s.clear / total).toFixed(0)}%  半透 ${(100 * s.semi / total).toFixed(1)}%  实心 ${(100 * s.solid / total).toFixed(0)}%  其中近白 ${s.whiteish}`)
  }
  writeFileSync('spike/food-sheet.png', await page.screenshot({ clip: { x: 0, y: 0, width: 900, height: 260 } }))
  console.log('截图 → spike/food-sheet.png')
} finally {
  await app?.close().catch(() => {})
  try {
    const { rmSync } = await import('node:fs')
    rmSync(userData, { recursive: true, force: true })
  } catch { /* EBUSY */ }
}
