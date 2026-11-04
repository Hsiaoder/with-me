// 一次性排查：把气泡底图从中间截短——删掉 [from, from+count) 这几行。
// 只许删「身子中段那几行完全均匀的行」，圆角行与尾巴行不能碰，否则气泡会变形。
// 用法：node spike/emote-shorten.mjs <输入png> <输出png> <起始行> <删几行>
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const FF = require('ffmpeg-static')
const src = process.argv[2]
const dst = process.argv[3]
const from = Number(process.argv[4])
const count = Number(process.argv[5])
if (!src || !dst || !Number.isInteger(from) || !Number.isInteger(count)) {
  throw new Error('用法：node spike/emote-shorten.mjs <输入png> <输出png> <起始行> <删几行>')
}

const ihdr = readFileSync(src).subarray(16, 24)
const W = ihdr.readUInt32BE(0)
const H = ihdr.readUInt32BE(4)
const raw = Buffer.from(
  execFileSync(FF, ['-loglevel', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 }),
)

// 删之前先看一眼：被删的这几行必须完全相同，否则删完会露出接缝。
const rowText = (y) => raw.subarray(y * W * 4, (y + 1) * W * 4).toString('hex')
const victims = [...Array(count).keys()].map((i) => rowText(from + i))
if (victims.some((v) => v !== victims[0])) throw new Error(`第 ${from}..${from + count - 1} 行不完全相同，删了会露出接缝`)

const outH = H - count
const out = Buffer.alloc(W * outH * 4)
raw.copy(out, 0, 0, from * W * 4)                    // 上半原样
raw.copy(out, from * W * 4, (from + count) * W * 4)  // 下半上移
console.log(`${W}x${H} → ${W}x${outH}（删掉第 ${from}..${from + count - 1} 行）`)

const dir = mkdtempSync(join(tmpdir(), 'emote-shorten-'))
const rawPath = join(dir, 'rgba.raw')
writeFileSync(rawPath, out)
execFileSync(FF, ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${outH}`, '-i', rawPath, dst])
console.log(`已写：${dst}`)
