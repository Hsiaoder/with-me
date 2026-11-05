/**
 * 一次性探针（throwaway）：把参考图和我们的重画并排渲染成 PNG，用眼睛对一遍。
 *
 * isPointInFill 量得出半径与着墨范围，但「尾巴读起来像不像从泡里长出来的」「环的
 * 白色通道有没有断」这种事只有看图才知道。占位素材会掩护这类缺陷（problem/05 §5.16）。
 *
 * 跑法：node spike/bubble-ab.mjs → spike/out/bubble-ab.png
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REF = 'C:/Users/11408/AppData/Local/Temp/chat-bubble-ref.svg'
const OURS = 'src/renderer/emotes/bubble.svg'
// 原图那条 path 没写 fill（iconfont 靠外层 CSS 上色），并排比之前钉成我们那支蓝，
// 不然一边是黑的另一边是蓝的，眼睛先骗一半。
const ref = readFileSync(REF, 'utf8').replace('<path d=', '<path fill="#92c7e3" d=')
const ours = readFileSync(OURS, 'utf8')
const ud = mkdtempSync(join(tmpdir(), 'bubble-ab-'))

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })

await page.setContent(`<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; font:12px sans-serif; }
  .row { display:flex; gap:24px; padding:16px; }
  .cell { display:flex; flex-direction:column; gap:6px; }
  .on-white, .on-dark { padding:8px; }
  .on-white { background:#ffffff; }
  .on-dark { background:#3a3f4a; }
  .box { width:220px; height:220px; }
  .box svg { width:100%; height:100%; display:block; }
</style>
<div class="row">
  <div class="cell"><b>参考（iconfont 原图，fill 用浏览器默认黑）</b>
    <div class="on-white"><div class="box">${ref}</div></div>
    <div class="on-dark"><div class="box">${ref}</div></div>
  </div>
  <div class="cell"><b>我们的重画（外沿铺蓝 + 内腔盖白）</b>
    <div class="on-white"><div class="box">${ours}</div></div>
    <div class="on-dark"><div class="box">${ours}</div></div>
  </div>
</div>`)
const png = await page.screenshot({ fullPage: true })
mkdirSync(join('spike', 'out'), { recursive: true })
writeFileSync(join('spike', 'out', 'bubble-ab.png'), png)
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/bubble-ab.png')
