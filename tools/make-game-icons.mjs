/**
 * 把 ImageGen 生的游戏图标（1024×1024）缩成列表用的 128×128 PNG，顺手抹掉右下角烧进像素的
 * 「AI生成」水印。像素活走 Electron 的 canvas（仓库没有图像库，Electron 本来就在，和 make-food-icons 同套路）。
 *
 * 用法（项目根）：node tools/make-game-icons.mjs
 * 产物：src/renderer/icons/game-{fly,guess,bubble}.png（128×128）。
 * 图标放在白底格子里，背景近白即可；水印在右下角背景区，涂白抹掉不影响主体。
 */
import { _electron as electron } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const OUT = 128
const JOBS = [
  ['E:/ai-pet/vibe_images/game-fly_1794077945293_0430cdea.png', 'game-fly.png'],
  ['E:/ai-pet/vibe_images/game-guess_1794077968759_aa61b4fb.png', 'game-guess.png'],
  ['E:/ai-pet/vibe_images/game-bubble_1794077991114_11fccebc.png', 'game-bubble.png'],
]

const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, PET_USER_DATA: join(process.env.TEMP || '/tmp', 'pet-game-icon-tool'), PET_FREEZE_CURSOR: '1' },
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => typeof OffscreenCanvas !== 'undefined', null, { timeout: 30_000 })
  for (const [src, name] of JOBS) {
    const data = readFileSync(src).toString('base64')
    const bytes = await page.evaluate(async (a) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + a.data)).blob())
      const W = bmp.width, H = bmp.height
      const c = new OffscreenCanvas(W, H)
      const ctx = c.getContext('2d')
      ctx.drawImage(bmp, 0, 0)
      // 右下角水印（约 x>80%, y>93%）涂白抹掉；那块是背景，不伤主体。
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(Math.round(W * 0.8), Math.round(H * 0.93), W, H)
      const dst = new OffscreenCanvas(a.out, a.out)
      const dctx = dst.getContext('2d')
      dctx.drawImage(c, 0, 0, W, H, 0, 0, a.out, a.out)
      const buf = new Uint8Array(await (await dst.convertToBlob({ type: 'image/png' })).arrayBuffer())
      return Array.from(buf)
    }, { data, out: OUT })
    writeFileSync(join(root, 'src/renderer/icons', name), Buffer.from(bytes))
    console.log('written', name, bytes.length, 'bytes')
  }
} finally {
  await app?.close().catch(() => {})
}
