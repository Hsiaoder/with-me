/**
 * 把 AI 生的食物图标总表切成能用的 PNG：分格 → 逐格取最大墨迹块 → 抠底 → 归一化 → 落盘。
 *
 * 为什么要有这个脚本而不是直接把整张图贴上去：
 * - 生图出来**没有 alpha 通道**（整张不透明），底是画上去的近白色（实测四角
 *   #fafbfe / #feffff / #fffdfd / #ffffff，不是纯白），所以不能按色全局抠，
 *   得**从格子边缘洪水填充**——白饭和饺子本身就是近白，全局阈值会把饭抠出洞；
 * - 右下角「AI生成」水印是烧进像素的，落在某一行里，得连像素一起丢掉；
 * - 内容尺寸实测占格 84%~122%（糖葫芦出格、大闸蟹偏小），不归一化就是一排大小不齐的格子。
 *
 * 用法（在项目根）：
 *   node tools/make-food-icons.mjs "<总表 png 路径>" [id,id,...] [行数] [膨胀半径] [底阈值]
 * 第二参数是**这张表里的出图顺序**（= 提示词里写的顺序，先上排从左到右、再下排），
 * 不给就用第一批六样（3 列 2 行）。
 * 产物：src/renderer/foods/<id>.png（128×128，四周留白，透明底）
 *
 * 为什么先**按投影空档切格**、再在格内取最大块，而不是全图连通域取前 N 大：
 * 第一批那样做过，实测两张表都出问题——第二张（12 样里的后 6 样）里西瓜和冰淇淋之间
 * 有一片很淡的投影，膨胀之后连成一座桥，两块并成一块，于是「前 6 大」里少一样、
 * 多出来的是零食袋旁边那两颗爱心（1227px²）。
 * 按行/列的墨迹投影找空档分格之后，跨格的桥根本进不到同一个候选里，
 * 每格只在自己的框内找自己的最大块。
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
  console.error('用法：node tools/make-food-icons.mjs "<总表 png 路径>" [id,id,...] [行数] [膨胀半径] [底阈值]')
  process.exit(1)
}
const IDS = (process.argv[3] ?? 'rice,tanghulu,crab,hotpot,dumpling,token').split(',')
const ROWS = Number(process.argv[4] ?? 2)
/** 膨胀半径：同一件东西的碎片（蟹腿、蒸汽、筷子）要能并成一个连通域。 */
const DILATE = Number(process.argv[5] ?? 14)
/** 近白底阈值：默认 242（老两批总表底是 #fafbfe）。个别生图底偏灰（实测 238,242,244）时调低，
 *  否则整张底被当成墨迹、抠底失效。只影响「连到格边的近白」，食物内部的白（米粒/汤圆）够不着边，留得住。 */
const BG = Number(process.argv[6] ?? 242)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, 'src', 'renderer', 'foods')

const OUT = 128
/** 内容归一化后占格子的比例：留一点呼吸，别顶到格子的圆角。 */
const FILL = 0.86

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

    // 近白 = 底。阈值放宽到 242/238，因为背景本身在 #fafbfe~#ffffff 之间飘，不是纯白。
    const ink = new Uint8Array(W * H)
    for (let p = 0; p < W * H; p++) {
      const i = p * 4
      ink[p] = d[i] >= a.bg && d[i + 1] >= a.bg && d[i + 2] >= a.bg - 4 ? 0 : 1
    }
    // 右下角「AI生成」水印是烧进像素的，当成底丢掉
    for (let y = Math.floor(H * 0.895); y < H; y++) {
      for (let x = Math.floor(W * 0.85); x < W; x++) ink[y * W + x] = 0
    }

    // ---- 按投影找「最稀的一行/列」当切口，切出行与列 ----
    // 为什么不是「找全空档」：这张表两样东西之间有极淡的投影，逐行数墨迹永远数不到 0，
    // 于是「空档」根本不存在（第一版这么写，投影只切出 1 行，直接报错）。
    // 表的结构是**已知的**（几行几列由调用方给），所以改成：在每个应有的内部边界附近
    // 的一段窗口里，找墨迹最少的那条线来切。窗口给 ±15%，切点仍然由像素说了算，
    // 不是按等分硬切——硬切正是上一版「把邻格一角切进来」的成因。
    const rowCount = (i) => { let n = 0; for (let x = 0; x < W; x++) n += ink[i * W + x]; return n }
    const colCount = (j) => { let n = 0; for (let y = 0; y < H; y++) n += ink[y * W + j]; return n }
    const rows = a.rows, cols = Math.round(a.ids.length / rows)
    const cuts = (total, count, vals) => {
      const out = []
      for (let k = 1; k < count; k++) {
        const pos = Math.round((total * k) / count)
        const span = Math.round(total * 0.15)
        let best = pos, bestV = Infinity
        for (let i = Math.max(1, pos - span); i <= Math.min(total - 2, pos + span); i++) {
          const v = vals(i)
          if (v < bestV) { bestV = v; best = i }
        }
        out.push({ at: best, ink: bestV })
      }
      return out
    }
    const rowCuts = cuts(H, rows, rowCount)
    const colCuts = cuts(W, cols, colCount)
    const edges = (total, list) => {
      const bounds = [0]
      for (const c of list) bounds.push(c.at)
      bounds.push(total - 1)
      const out = []
      for (let i = 0; i < bounds.length - 1; i++) out.push([bounds[i], bounds[i + 1]])
      return out
    }
    const rowBands = edges(H, rowCuts)
    const colBands = edges(W, colCuts)

    // ---- 每格内：膨胀 + 连通域，取最大块的原始墨迹包围盒 ----
    const cellBox = (x0, x1, y0, y1, dilate) => {
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1
      const R = dilate
      const col = new Int32Array(cw * ch)
      for (let y = 0; y < ch; y++) {
        let run = 0
        for (let x = 0; x < cw; x++) {
          run += ink[(y0 + y) * W + (x0 + x)]
          col[y * cw + x] = (y ? col[(y - 1) * cw + x] : 0) + run
        }
      }
      const at = (x, y) => col[Math.min(ch - 1, Math.max(0, y)) * cw + Math.min(cw - 1, Math.max(0, x))]
      const dil = new Uint8Array(cw * ch)
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const ax0 = x - R - 1, ax1 = x + R, ay0 = y - R - 1, ay1 = y + R
        dil[y * cw + x] = at(ax1, ay1) - at(ax0, ay1) - at(ax1, ay0) + at(ax0, ay0) > 0 ? 1 : 0
      }
      const lab = new Int32Array(cw * ch).fill(-1)
      const comps = []
      const stack = []
      for (let start = 0; start < cw * ch; start++) {
        if (!dil[start] || lab[start] !== -1) continue
        const box = { minx: cw, miny: ch, maxx: 0, maxy: 0, area: 0 }
        lab[start] = 1
        stack.length = 0
        stack.push(start)
        while (stack.length) {
          const p = stack.pop()
          const x = p % cw, y = (p - x) / cw
          if (ink[(y0 + y) * W + (x0 + x)]) {
            box.area++
            if (x < box.minx) box.minx = x; if (x > box.maxx) box.maxx = x
            if (y < box.miny) box.miny = y; if (y > box.maxy) box.maxy = y
          }
          if (x > 0 && dil[p - 1] && lab[p - 1] === -1) { lab[p - 1] = 1; stack.push(p - 1) }
          if (x + 1 < cw && dil[p + 1] && lab[p + 1] === -1) { lab[p + 1] = 1; stack.push(p + 1) }
          if (y > 0 && dil[p - cw] && lab[p - cw] === -1) { lab[p - cw] = 1; stack.push(p - cw) }
          if (y + 1 < ch && dil[p + cw] && lab[p + cw] === -1) { lab[p + cw] = 1; stack.push(p + cw) }
        }
        if (box.area > 0) comps.push(box)
      }
      comps.sort((m, n) => n.area - m.area)
      if (comps.length === 0) throw new Error(`格子 x${x0}..${x1} y${y0}..${y1} 里没有墨迹`)
      const c = comps[0]
      return { ...c, x0, y0, cw, ch, others: comps.length - 1 }
    }

    const outs = []
    const report = []
    for (let r = 0; r < a.rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c
        const [y0, y1] = rowBands[r], [x0, x1] = colBands[c]
        const box = cellBox(x0, x1, y0, y1, a.dilate)
        // 包围盒换算回全图坐标
        const minx = x0 + box.minx, maxx = x0 + box.maxx
        const miny = y0 + box.miny, maxy = y0 + box.maxy
        report.push(`${a.ids[k]} 面积 ${box.area}px² 包围盒 ${maxx - minx}x${maxy - miny}@(${Math.round((minx + maxx) / 2)},${Math.round((miny + maxy) / 2)}) 同格另 ${box.others} 块`)

        const cx0 = minx, cy0 = miny
        const cw2 = maxx - cx0 + 1, ch2 = maxy - cy0 + 1
        const cell = fg.getImageData(cx0, cy0, cw2, ch2)
        const cd = cell.data
        const isBg = (i) => cd[i] >= a.bg && cd[i + 1] >= a.bg && cd[i + 2] >= a.bg - 4
        // 从这一块的**包围盒四条边**洪水填充：连到边的近白才是底。
        // 这一步是整件事的关键——白饭的米粒、饺子的面皮、年糕的白块都是近白，
        // 按色全局抠会把食物本体抠成透明；它们被描边关在内部，够不着边，所以留得住。
        const seen = new Uint8Array(cw2 * ch2)
        const st = []
        const push = (x, y) => {
          const p = y * cw2 + x
          if (seen[p]) return
          if (isBg(p * 4)) { seen[p] = 1; st.push(p) }
        }
        for (let x = 0; x < cw2; x++) { push(x, 0); push(x, ch2 - 1) }
        for (let y = 0; y < ch2; y++) { push(0, y); push(cw2 - 1, y) }
        while (st.length) {
          const p = st.pop()
          const x = p % cw2, y = (p - x) / cw2
          if (x > 0) push(x - 1, y)
          if (x + 1 < cw2) push(x + 1, y)
          if (y > 0) push(x, y - 1)
          if (y + 1 < ch2) push(x, y + 1)
        }
        for (let p = 0; p < seen.length; p++) if (seen[p]) cd[p * 4 + 3] = 0

        const tmp = new OffscreenCanvas(cw2, ch2)
        tmp.getContext('2d').putImageData(cell, 0, 0)
        const iw = cw2, ih = ch2
        const s = (a.out * a.fill) / Math.max(iw, ih)
        const dst = new OffscreenCanvas(a.out, a.out)
        const dg = dst.getContext('2d')
        dg.imageSmoothingQuality = 'high'
        dg.drawImage(tmp, 0, 0, cw2, ch2,
          Math.round((a.out - iw * s) / 2), Math.round((a.out - ih * s) / 2),
          Math.round(iw * s), Math.round(ih * s))
        const buf = new Uint8Array(await (await dst.convertToBlob({ type: 'image/png' })).arrayBuffer())
        let bin = ''
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
        outs.push(btoa(bin))
      }
    }
    return { outs, report, bands: { rowBands, colBands, rowCuts, colCuts } }
  }, { data: b64, ids: IDS, rows: ROWS, out: OUT, fill: FILL, dilate: DILATE, bg: BG })

  mkdirSync(outDir, { recursive: true })
  console.log(`切点（位置与该行/列的墨迹数）：行 ${JSON.stringify(pngs.bands.rowCuts)} 列 ${JSON.stringify(pngs.bands.colCuts)}`)
  console.log(`分格：行 ${JSON.stringify(pngs.bands.rowBands)} 列 ${JSON.stringify(pngs.bands.colBands)}`)
  console.log('逐格最大块：\n  ' + pngs.report.join('\n  '))
  for (let i = 0; i < IDS.length; i++) {
    const buf = Buffer.from(pngs.outs[i], 'base64')
    writeFileSync(join(outDir, `${IDS[i]}.png`), buf)
    console.log(`  ${IDS[i]}.png  ${buf.length} 字节`)
  }
  console.log(`食物图标 ${IDS.length} 张 → src/renderer/foods/`)
} finally {
  await app?.close().catch(() => {})
}
