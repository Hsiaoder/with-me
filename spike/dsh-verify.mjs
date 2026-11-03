/**
 * 一次性：验证 dsh-pet 素材转出来的试穿皮肤能不能真装载、画面是不是在动。
 * 留在文件里跑，不用 node -e 内联——内联的路径转义已经把 setPath 打挂过一次。
 * 跑法：node spike/dsh-verify.mjs [userData目录]
 */
import { _electron as electron } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ud = process.argv[2] ?? readFileSync(join(process.env.TEMP, 'dsh-userdir.txt'), 'utf8').trim()
if (!existsSync(ud)) {
  console.error(`userData 不存在：${ud}\n用法：node spike/dsh-verify.mjs <userData目录>`)
  process.exit(1)
}
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: ud } })
try {
  const page = await app.firstWindow()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  const d = await page.evaluate(() => {
    const v = document.querySelector('video.is-front')
    return {
      skin: window.__petDebug.skinName,
      cur: window.__petDebug.current,
      src: v.currentSrc,
      wh: v.videoWidth + 'x' + v.videoHeight,
      t: v.currentTime,
      hit: window.__petDebug.hitBox,
    }
  })
  await new Promise((r) => setTimeout(r, 1500))
  const t2 = await page.evaluate(() => document.querySelector('video.is-front').currentTime)
  console.log(`装载的皮肤 : ${d.skin}`)
  console.log(`当前动画   : ${d.cur.pool}/${d.cur.name}`)
  console.log(`素材地址   : ${d.src}`)
  console.log(`解码尺寸   : ${d.wh}   时间在推进：${d.t.toFixed(2)} → ${t2.toFixed(2)}`)
  console.log(`命中框(CSS): ${JSON.stringify(d.hit)}`)
  console.log(`页面异常   : ${errs.length ? errs.join('; ') : '无'}`)
} finally {
  await app.close().catch(() => {})
}
