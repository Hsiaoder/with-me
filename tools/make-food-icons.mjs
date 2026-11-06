/**
 * 把 AI 生的一张食物图标总表切成六个能用的 PNG：逐格裁 → 抠底 → 去水印 → 归一化 → 落盘。
 *
 * 为什么要有这个脚本而不是直接把整张图贴上去：
 * - 生图出来**没有 alpha 通道**（整张不透明），底是画上去的近白色（实测四角
 *   #fafbfe / #feffff / #fffdfd / #ffffff，不是纯白），所以不能按色全局抠，
 *   得**从格子边缘洪水填充**——白饭和饺子本身就是近白，全局阈值会把饭抠出洞；
 * - 右下角「AI生成」水印是烧进像素的，落在代币那一格里，得连像素一起丢掉；
 * - 六个内容尺寸实测占格 84%~122%（糖葫芦出格、大闸蟹偏小），不归一化就是一排大小不齐的格子。
 *
 * 用法（在项目根）：
 *   node tools/make-food-icons.mjs "E:/ai-pet/vibe_images/xxx.png"
 * 产物：src/renderer/foods/<id>.png（128×128，四周留白，透明底）
 *
 * 像素活走 Electron 的 canvas：仓库的开发依赖里没有图像库，而 Electron 本来就在，
 * 解码 / 洪水填充 / 编码三步都是浏览器 API，不必为此再拉一个依赖。
 * 里面那段是**浏览器侧的 JS**，所以不写类型标注（.mjs 由 node 直接跑，不做类型剥离）。
 */
import { _electron as electron } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = process.argv[2]
if (!src) {
  console.error('用法：node tools/make-food-icons.mjs <总表 png 路径>')
  process.exit(1)
}
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, 'src', 'renderer', 'foods')

/**
 * 总表是 3 列 × 2 行，出图顺序 = 提示词里写的顺序（白饭 / 糖葫芦 / 大闸蟹 / 火锅 / 饺子 / 代币），
 * 而 `FOODS` 的顺序是 代币 / 白饭 / …，两者不同形，所以这里**显式**对上 id，不靠顺序猜。
 * 注意：**格子坐标不能用来切图**——实测模型并没有把六个东西严格摆成等分网格，
 * 按 1/3 宽硬切会把邻格的一角切进来（代币里带一片饺子、糖葫芦两边挂着别人的碎片）。
 * 所以改成按内容分块：先膨胀墨迹把同一件东西的碎片并起来，再连通域标记，取面积最大的六块。
 */
const GRID_TO_ID = ['rice', 'tanghulu', 'crab', 'hotpot', 'dumpling', 'token']
const OUT = 128
/** 内容归一化后占格子的比例：留一点呼吸，别顶到格子的圆角。 */
const FILL = 0.86
/** 膨胀半径：同一件东西的碎片（蟹腿、糖葫芦的球、蒸汽）要能并成一个连通域。 */
const DILATE = 14

const b64 = readFileSync(src).toString('base64')
const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, PET_USER_DATA: join(process.env.TEMP || '/tmp', 'pet-food-tool'), PET_FREEZE_CURSOR: '1' },
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
  const pngs = await page.evaluate(async (a) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + a.data)).blob())
    const W = bmp.width, H = bmp.height
    const full = new OffscreenCanvas(W, H)
    const fg = full.getContext('2d', { willReadFrequently: true })
    fg.drawImage(bmp, 0, 0)
    const d = fg.getImageData(0, 0, W, H).data

    // 近白 = 底。阈值放宽到 238+，因为背景本身在 #fafbfe~#ffffff 之间飘，不是纯白。
    const ink = new Uint8Array(W * H)
    for (let p = 0; p < W * H; p++) {
      const i = p * 4
      ink[p] = d[i] >= 242 && d[i + 1] >= 242 && d[i + 2] >= 238 ? 0 : 1
    }
    // 右下角「AI生成」水印是烧进像素的，当成底丢掉
    for (let y = Math.floor(H * 0.895); y < H; y++) {
      for (let x = Math.floor(W * 0.85); x < W; x++) ink[y * W + x] = 0
    }

    // 膨胀：积分图算 (2R+1)² 窗口里的墨迹和，>0 就算连上。
    // 目的是把一件东西的碎片（大闸蟹的每条腿、糖葫芦的每颗球）并成一个连通域。
    const R = a.dilate
    const col = new Int32Array(W * H)
    for (let y = 0; y < H; y++) {
      let run = 0
      for (let x = 0; x < W; x++) {
        run += ink[y * W + x]
        col[y * W + x] = (y ? col[(y - 1) * W + x] : 0) + run
      }
    }
    const at = (x, y) => col[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))]
    const dil = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = x - R - 1, x1 = x + R, y0 = y - R - 1, y1 = y + R
      const sum = at(x1, y1) - at(x0, y1) - at(x1, y0) + at(x0, y0)
      dil[y * W + x] = sum > 0 ? 1 : 0
    }

    // 连通域标记（膨胀图上 BFS），每块统计**原始墨迹**的包围盒与面积
    const lab = new Int32Array(W * H).fill(-1)
    const comps = []
    const stack = []
    for (let start = 0; start < W * H; start++) {
      if (!dil[start] || lab[start] !== -1) continue
      const id = comps.length
      const box = { minx: W, miny: H, maxx: 0, maxy: 0, area: 0 }
      lab[start] = id
      stack.length = 0
      stack.push(start)
      while (stack.length) {
        const p = stack.pop()
        const x = p % W, y = (p - x) / W
        if (ink[p]) {
          box.area++
          if (x < box.minx) box.minx = x; if (x > box.maxx) box.maxx = x
          if (y < box.miny) box.miny = y; if (y > box.maxy) box.maxy = y
        }
        if (x > 0 && dil[p - 1] && lab[p - 1] === -1) { lab[p - 1] = id; stack.push(p - 1) }
        if (x + 1 < W && dil[p + 1] && lab[p + 1] === -1) { lab[p + 1] = id; stack.push(p + 1) }
        if (y > 0 && dil[p - W] && lab[p - W] === -1) { lab[p - W] = id; stack.push(p - W) }
        if (y + 1 < H && dil[p + W] && lab[p + W] === -1) { lab[p + W] = id; stack.push(p + W) }
      }
      if (box.area > 0) comps.push({ ...box, cx: (box.minx + box.maxx) / 2, cy: (box.miny + box.maxy) / 2 })
    }
    // 取面积最大的六块（火锅的蒸汽那种小碎片自然落选），再按「先上后下、同一行先左后右」排
    const picked = comps.slice().sort((m, n) => n.area - m.area).slice(0, a.ids.length)
    if (picked.length !== a.ids.length) throw new Error(`只分出 ${picked.length} 块，对不上 ${a.ids.length} 个食物`)
    picked.sort((m, n) => (m.cy < H / 2 ? 0 : 1) - (n.cy < H / 2 ? 0 : 1) || m.cx - n.cx)
    const report = picked.map((c) => `${c.area}px² ${Math.round(c.maxx - c.minx)}x${Math.round(c.maxy - c.miny)}@(${Math.round(c.cx)},${Math.round(c.cy)})`)

    const outs = []
    for (let k = 0; k < picked.length; k++) {
      const c = picked[k]
      const x0 = Math.floor(c.minx), y0 = Math.floor(c.miny)
      const cw = Math.ceil(c.maxx) - x0 + 1, chh = Math.ceil(c.maxy) - y0 + 1
      const cell = fg.getImageData(x0, y0, cw, chh)
      const cd = cell.data
      const isBg = (i) => cd[i] >= 242 && cd[i + 1] >= 242 && cd[i + 2] >= 238
      // 从这一块的**包围盒四条边**洪水填充：连到边的近白才是底。
      // 这一步是整件事的关键——白饭的米粒、饺子的面皮都是近白，
      // 按色全局抠会把食物本体抠成透明；它们被描边关在内部，够不着边，所以留得住。
      const seen = new Uint8Array(cw * chh)
      const st = []
      const push = (x, y) => {
        const p = y * cw + x
        if (seen[p]) return
        if (isBg(p * 4)) { seen[p] = 1; st.push(p) }
      }
      for (let x = 0; x < cw; x++) { push(x, 0); push(x, chh - 1) }
      for (let y = 0; y < chh; y++) { push(0, y); push(cw - 1, y) }
      while (st.length) {
        const p = st.pop()
        const x = p % cw, y = (p - x) / cw
        if (x > 0) push(x - 1, y)
        if (x + 1 < cw) push(x + 1, y)
        if (y > 0) push(x, y - 1)
        if (y + 1 < chh) push(x, y + 1)
      }
      for (let p = 0; p < seen.length; p++) if (seen[p]) cd[p * 4 + 3] = 0

      const tmp = new OffscreenCanvas(cw, chh)
      tmp.getContext('2d').putImageData(cell, 0, 0)
      const iw = c.maxx - c.minx + 1, ih = c.maxy - c.miny + 1
      const s = (a.out * a.fill) / Math.max(iw, ih)
      const dst = new OffscreenCanvas(a.out, a.out)
      const dg = dst.getContext('2d')
      dg.imageSmoothingQuality = 'high'
      dg.drawImage(tmp, 0, 0, cw, chh,
        Math.round((a.out - iw * s) / 2), Math.round((a.out - ih * s) / 2),
        Math.round(iw * s), Math.round(ih * s))
      const buf = new Uint8Array(await (await dst.convertToBlob({ type: 'image/png' })).arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
      outs.push(btoa(bin))
    }
    return { outs, report }
  }, { data: b64, ids: GRID_TO_ID, out: OUT, fill: FILL, dilate: DILATE })

  mkdirSync(outDir, { recursive: true })
  console.log('分块（面积 包围盒@中心）：\n  ' + pngs.report.join('\n  '))
  for (let i = 0; i < GRID_TO_ID.length; i++) {
    const buf = Buffer.from(pngs.outs[i], 'base64')
    writeFileSync(join(outDir, `${GRID_TO_ID[i]}.png`), buf)
    console.log(`  ${GRID_TO_ID[i]}.png  ${buf.length} 字节`)
  }
  console.log(`食物图标 ${GRID_TO_ID.length} 张 → src/renderer/foods/`)
} finally {
  await app?.close().catch(() => {})
}
