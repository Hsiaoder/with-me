// 一次性排查：把 8 个 Pixel 风格的 emote__（空气泡底图）各调色板打出来，
// 看哪一版的描边在浅色桌面上还读得出来。用完可删。
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const FF = require('ffmpeg-static')
const PACK = 'E:/ai-pet/ui/kenney_emotes-pack'

for (let s = 1; s <= 8; s++) {
  const file = join(PACK, 'PNG', 'Pixel', `Style ${s}`, 'emote__.png')
  const raw = execFileSync(FF, ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 })
  const n = Math.round(Math.sqrt(raw.length / 4))
  const m = new Map()
  for (let i = 0; i < n * n; i++) {
    const k = [raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2], raw[i * 4 + 3]].join(',')
    m.set(k, (m.get(k) || 0) + 1)
  }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  console.log(`P${s} ${n}x${n}  ` + top.map(([k, v]) => `${k}×${v}`).join('  |  '))
}
