/**
 * 快拖之后桌面上残留一块、过一会儿自己消失——这种问题只能在真实桌面上看像素。
 *
 * 为什么要外部抓屏：渲染层内截图（page.screenshot）拿到的是图层内容，
 * 「窗口让出来的脏区有没有被重画」是 DWM 最终合成的事，只有桌面帧知道。
 *
 * 判据不靠坐标换算：同一块颜色在几个时刻的团块签名。
 * 宠物本人的团块跟着拖拽走、最后停在终点；残留是另一种签名——
 * 出现在让出来的区域里，下一拍又没了。
 *
 * 跑法：node tools/ghost-probe.mjs
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 皮肤里那几块纯色，用于在桌面上找团块。 */
const SWATCHES = [
  ['idle 绿', 0x2c, 0xe6, 0x8a],
  ['drag 粉', 0xe6, 0x2c, 0xa8],
  ['turn 橙', 0xe6, 0xa3, 0x2c],
  ['click 红', 0xe6, 0x57, 0x2c],
]
const TOL = 26
const CELL = 32

const work = mkdtempSync(join(tmpdir(), 'ghost-'))
const rawPath = join(work, 'screen.raw')

/** PowerShell 里那段脚本必须全 ASCII：WinPS 5.1 会把 UTF-8 的中文注释读成乱码。 */
const PS = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
$rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$arr = New-Object byte[] ($data.Stride * $data.Height)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $arr, 0, $arr.Length)
[System.IO.File]::WriteAllBytes('${rawPath}', $arr)
$bmp.UnlockBits($data)
$out = "$($bmp.Width) $($data.Stride)"
$g.Dispose()
$bmp.Dispose()
$out
`

function capture() {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], {
    encoding: 'utf8',
  }).trim().split(/\s+/)
  const h = Math.floor(readFileSync(rawPath).length / Number(out[1]))
  return { w: Number(out[0]), h, buf: readFileSync(rawPath) }
}

/** 同色像素按 32px 格子聚成团块，返回 [{label,count,bbox}]，按像素数降序。 */
function clusters(shot) {
  const { w, h, buf } = shot
  const found = []
  for (const [label, r0, g0, b0] of SWATCHES) {
    const cols = Math.ceil(w / CELL)
    const rows = Math.ceil(h / CELL)
    const grid = new Uint8Array(cols * rows)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w * 4 + x * 4          // BGRA
        if (Math.abs(buf[i] - b0) <= TOL && Math.abs(buf[i + 1] - g0) <= TOL && Math.abs(buf[i + 2] - r0) <= TOL) {
          grid[Math.floor(y / CELL) * cols + Math.floor(x / CELL)] = 1
        }
      }
    }
    const seen = new Uint8Array(cols * rows)
    for (let c = 0; c < grid.length; c++) {
      if (!grid[c] || seen[c]) continue
      const stack = [c]
      let cells = 0
      let x0 = cols, y0 = rows, x1 = 0, y1 = 0
      while (stack.length) {
        const p = stack.pop()
        if (seen[p] || !grid[p]) continue
        seen[p] = 1
        cells++
        const px = p % cols, py = (p - px) / cols
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py)
        if (px > 0) stack.push(p - 1)
        if (px < cols - 1) stack.push(p + 1)
        if (py > 0) stack.push(p - cols)
        if (py < rows - 1) stack.push(p + cols)
      }
      if (cells >= 2) {
        found.push({ label, cells, px: cells * CELL * CELL, bbox: [x0 * CELL, y0 * CELL, (x1 + 1) * CELL, (y1 + 1) * CELL] })
      }
    }
  }
  return found.sort((a, b) => b.cells - a.cells)
}

const show = (tag, list) => {
  if (!list.length) return console.log(`  ${tag.padEnd(22)} 没有色块`)
  for (const c of list) {
    console.log(`  ${tag.padEnd(22)} ${c.label} ${String(c.px).padStart(6)}px @ [${c.bbox.join(',')}]`)
  }
}

const keyOf = (c) => `${c.label}@${c.bbox.join(',')}`

/**
 * 壁纸和图标本身就有接近这几块颜色的区域，光看一帧的团块清单没法判残留。
 * 残留的签名是**瞬态**：某一帧在、下一帧没了，而且不在宠物当前的位置上。
 */
function transient(early, late) {
  const lateKeys = new Set(late.map(keyOf))
  return early.filter((c) => !lateKeys.has(keyOf(c)))
}

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: mkdtempSync(join(tmpdir(), 'ghost-pet-')) },
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })

  // 冻住行为链：__testPlay 播完一条就停，不再有换片/走动，剩下能动的只有我手动拖的位置
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  const geo = await page.evaluate(() => ({
    sx: window.screenX, sy: window.screenY, dpr: window.devicePixelRatio,
    iw: window.innerWidth, ih: window.innerHeight, hit: window.__petDebug.hitBox,
  }))
  const shot0 = capture()
  const k = shot0.w / (geo.sx + geo.iw)
  console.log(`抓屏 ${shot0.w}x${shot0.h}，覆盖层 CSS ${geo.iw}x${geo.ih} @(${geo.sx},${geo.sy}) dpr=${geo.dpr} → 换算系数 ${k.toFixed(3)}`)
  console.log(`宠物当前命中框(CSS) [${[geo.hit.x, geo.hit.y, geo.hit.w, geo.hit.h].map((v) => Math.round(v)).join(',')}]`)
  show('起点', clusters(shot0))

  let ghosts = 0
  for (let round = 1; round <= 5; round++) {
    // 每轮重取命中框：上一轮结束时宠物已经被挪回左下，用旧坐标点下去会拖空
    const cur = await page.evaluate(() => window.__petDebug.hitBox)
    const from = { x: Math.round(cur.x + cur.w / 2), y: Math.round(cur.y + cur.h / 2) }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    // 快速大幅甩动：每跳 130px、间隔 12ms，比人手正常拖动更狠
    let p = from
    for (let i = 0; i < 8; i++) {
      p = { x: Math.min(geo.iw - 40, p.x + 130), y: Math.max(40, p.y - 60) }
      await page.mouse.move(p.x, p.y)
      await page.waitForTimeout(12)
    }
    await page.mouse.up()
    const a = clusters(capture())
    await page.waitForTimeout(250)
    const b = clusters(capture())
    await page.waitForTimeout(600)
    const c = clusters(capture())
    const end = await page.evaluate(() => window.__petDebug.hitBox)
    const goneAB = transient(a, c)
    const goneB = transient(b, c)
    console.log(`  第${round}次 拖动 ${Math.round(cur.x)},${Math.round(cur.y)} → ${Math.round(end.x)},${Math.round(end.y)}（CSS，位移 ${Math.round(Math.hypot(end.x - cur.x, end.y - cur.y))}px）`)
    console.log(`    松手即在、850ms 后没了的团块：${goneAB.length ? goneAB.map((g) => `${g.label} ${g.px}px@[${g.bbox.join(',')}]`).join(' + ') : '无'}`)
    console.log(`    +250ms 在、850ms 后没了的团块：${goneB.length ? goneB.map((g) => `${g.label} ${g.px}px@[${g.bbox.join(',')}]`).join(' + ') : '无'}`)
    ghosts += goneAB.length + goneB.length
    // 回到左下再甩，保证每次都拖过同一片干净区域
    await page.evaluate((pos) => window.__petDebug.moveTo(pos), { x: 60, y: geo.ih - 260 })
    await page.waitForTimeout(400)
  }
  console.log(`\n结论：${ghosts === 0 ? '本机 DWM 桌面帧里没有任何瞬态色块残留' : `本机出现 ${ghosts} 处瞬态团块，需要继续查`}`)
} finally {
  await app.close().catch(() => {})
  try {
    rmSync(work, { recursive: true, force: true })
  } catch { /* Windows 上句柄可能还没释放 */ }
}
