/**
 * 再生界面字体子集：从 src 的字符串字面量抠真实字符表，裁思源黑体两档 + Fredoka 数字集。
 * 跑法：npm run fonts（源 OTF/TTF 在仓库外，用 FONT_SRC_DIR 指目录；默认见下）。
 * 产物提交进 src/renderer/fonts/，build 不跑这一步（源文件各 16MB，不入库），靠 copy-static 搬 woff2。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const OUT_DIR = path.join(ROOT, 'src', 'renderer', 'fonts')
const SRC_DIR = process.env.FONT_SRC_DIR || 'E:/ai-pet/pet-font-research/_tmp'

/** 逐字符状态机：剥掉 // 行注释与块注释，再只取引号内的内容。 */
function stripComments(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
    } else {
      out += c
      i++
    }
  }
  return out
}

/** 引号配对扫描：跳过转义，跨行模板串也吃进来。 */
function literals(text) {
  let out = ''
  let i = 0
  const n = text.length
  const QUOTES = ['"', "'", '`']
  while (i < n) {
    const c = text[i]
    if (QUOTES.includes(c)) {
      i++
      const start = i
      while (i < n && text[i] !== c) i += text[i] === '\\' ? 2 : 1
      out += text.slice(start, i)
      i++
    } else i++
  }
  return out
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|css|html)$/.test(e.name)) acc.push(p)
  }
  return acc
}

const files = walk(SRC)
let code = ''
let raw = ''
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  raw += t
  code += literals(stripComments(t))
}

const isHan = (ch) => ch.codePointAt(0) >= 0x4e00 && ch.codePointAt(0) <= 0x9fff
const ui = [...new Set([...code].filter(isHan))]
const inCommentsOnly = [...new Set([...raw].filter(isHan))].filter((c) => !code.includes(c))
const symbols = [...new Set(code.match(/[^\x00-\x7f]/g) || [])].filter((c) => !isHan(c))
// 状态栏的 62 / Lv.2 / 2分5秒 仍走思源，所以 ASCII 可打印整段进字表，别只裁汉字。
const ascii = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('')

const MUST = ['昵称', '经验', '亲密', '饥饿', '心情', '宠物档案', '正在吃饭', '打招呼', '在线时间', '等级']
const missing = MUST.join('').split('').filter((c) => isHan(c) && !ui.includes(c))
console.log(`源文件 ${files.length} 个 | 字面量汉字 ${ui.length} | 注释专属汉字 ${inCommentsOnly.length}（反向对照：必须 > 0）`)
if (missing.length) {
  console.error(`必须出现的词缺字：${missing.join('')}`)
  process.exit(1)
}
if (inCommentsOnly.length === 0) {
  console.error('反向对照失败：注释专属字表为空，说明剥注释没生效')
  process.exit(1)
}

const sansText = ui.join('') + symbols.join('') + ascii
// 飘字只有「+N」走 Fredoka，中文标签逐字回退落到思源；故 Fredoka 只裁数字与加减点空格。
const numText = '0123456789+. '
console.log(`思源子集码点 ${new Set(sansText).size}（汉字 ${ui.length} + 符号 ${symbols.length} + ASCII）| Fredoka 码点 ${new Set(numText).size}`)

fs.mkdirSync(OUT_DIR, { recursive: true })
const jobs = [
  // 用 Noto Sans SC（思源黑体的 Google 发行版，可变字重轴）：一档子集同时覆盖 400/500，
  // 比两档静态省一半。不用 Adobe 原版 OTF：它内部名字含 Reserved Font Name「Source」，
  // 子集属 Modified Version 会踩 OFL 第 3 条；Noto 内部名不含 Source，合规。
  ['with-me-sans-var.woff2', 'NotoSansSC-var.ttf', sansText],
  ['with-me-num-400.woff2', 'Fredoka.ttf', numText],
]
for (const [out, file, text] of jobs) {
  const src = fs.readFileSync(path.join(SRC_DIR, file))
  const t0 = Date.now()
  const woff2 = await subsetFont(src, text, { targetFormat: 'woff2' })
  fs.writeFileSync(path.join(OUT_DIR, out), woff2)
  console.log(`${out}: ${(src.length / 1048576).toFixed(2)} MB → ${woff2.length} B (${(woff2.length / 1024).toFixed(1)} KB)，${Date.now() - t0} ms`)
}