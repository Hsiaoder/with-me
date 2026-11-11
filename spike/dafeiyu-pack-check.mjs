/**
 * 大肥鱼皮肤包的装载验证：装好的包能不能被程序读起来并真的解出画面。
 * 跑法：npm run skin:pack（先出 build/skin/dafeiyu）→ npm run build && node spike/dafeiyu-pack-check.mjs
 * 用临时 PET_USER_DATA，不碰真实 %APPDATA%；观感（动画对不对味）交真机看。
 */
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const USER = join(ROOT, 'build', 'verify-user')
const SKIN = join(USER, 'skins', 'dafeiyu')

rmSync(USER, { recursive: true, force: true })
mkdirSync(join(USER, 'skins'), { recursive: true })
cpSync(join(ROOT, 'build', 'skin', 'dafeiyu'), SKIN, { recursive: true })
writeFileSync(join(USER, 'save.json'), JSON.stringify({
  version: 1, skin: 'dafeiyu', stats: { hunger: 80, mind: 80, clean: 80, mood: 80 }, lastSeenAt: 1,
}, null, 2), 'utf8')

let app
try {
  app = await electron.launch({ args: ['.'], cwd: ROOT, env: { ...process.env, PET_USER_DATA: USER } })
  const page = await app.firstWindow()
  const warnings = []
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
  await page.waitForFunction(
    () => !!window.__petDebug && (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0,
    null, { timeout: 30_000 },
  )
  const got = await page.evaluate(() => ({
    skinName: window.__petDebug.skinName,
    src: document.querySelector('video.is-front')?.currentSrc ?? '',
    width: document.querySelector('video.is-front')?.videoWidth ?? 0,
    height: document.querySelector('video.is-front')?.videoHeight ?? 0,
    pools: Object.fromEntries(Object.entries(window.__petDebug.pools ?? {}).map(([k, v]) => [k, v.length])),
  }))
  console.log(JSON.stringify({ got, warnings }, null, 2))
  assert.equal(got.skinName, '大肥鱼', '装载的不是大肥鱼')
  assert.match(got.src, /app:\/\/skin\//, '素材没走 app://skin 资源根')
  assert.ok(got.width > 0 && got.height > 0, '视频没解出画面')
  assert.deepEqual(warnings, [], '装载有警告')
  console.log('OK 大肥鱼皮肤包装载通过')
} finally {
  await app?.close().catch(() => {})
}
