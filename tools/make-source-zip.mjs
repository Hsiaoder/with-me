/**
 * 出「源码包」：Release 的第二渠道（第一渠道是 portable.zip）。
 *
 * 与安装包的区别：不带 Electron 运行时，用户机器上现场装（见 tools/run.ps1），
 * 整条链路没有「签过名的 exe」，也就不触发 SmartScreen 的未知发布者。
 *
 * 带 dist/ 是故意的：不带的话用户还得装 TypeScript 才能跑，
 * 而 devDependencies 里的 ffmpeg-static / playwright 会把这条路拖垮。
 *
 * 用法：node tools/make-source-zip.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { zipSync } from 'fflate'

const ROOT = process.cwd()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const OUT_DIR = resolve(ROOT, 'release')
const OUT = join(OUT_DIR, `with-me-${pkg.version}-source.zip`)

/** 必须存在，缺一个就不出包：发出去的包跑不起来，比不发更糟。 */
const REQUIRED = [
  'dist/main/index.js',
  'dist/preload/index.cjs',
  'dist/renderer/index.html',
  'skins/block/manifest.json',
  'run.cmd',
  'tools/run.ps1',
  'tools/install-skins.ps1',
  'LICENSE',
]

/** 顶层条目：目录递归收，文件逐个收。 */
const INCLUDE = [
  'src',
  'tools',
  'test',
  'skins',
  'assets',
  'dist',
  'skins-inbox',
  'run.cmd',
  '启动.vbs',
  'package.json',
  'package-lock.json',
  '.npmrc',
  'README.md',
  'LICENSE',
  'NOTICE.md',
  'licenses.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'vitest.config.ts',
  'electron-builder.yml',
]

/** 永远不进包：本机状态、用户自己的皮肤包、与运行无关的产物。 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.idea', '.superpowers', '.runtime', 'userdata',
  'release', 'release_fresh', 'release_verify', 'release-out', 'release-tray-check',
  'spike', 'test-results', 'playwright-report',
])
const SKIP_EXT = new Set(['.zip', '.log', '.tmp', '.bak'])

const files = {}

function walk(abs) {
  if (SKIP_DIRS.has(basename(abs))) return
  const st = statSync(abs)
  if (st.isDirectory()) {
    for (const child of readdirSync(abs)) walk(join(abs, child))
    return
  }
  const dot = basename(abs).lastIndexOf('.')
  const ext = dot >= 0 ? basename(abs).slice(dot).toLowerCase() : ''
  if (SKIP_EXT.has(ext)) return
  files[relative(ROOT, abs).split(sep).join('/')] = new Uint8Array(readFileSync(abs))
}

for (const entry of INCLUDE) {
  const abs = join(ROOT, entry)
  if (!existsSync(abs)) {
    console.warn(`! 跳过不存在的 ${entry}`)
    continue
  }
  walk(abs)
}

const missing = REQUIRED.filter((p) => !files[p])
if (missing.length > 0) {
  console.error('不出包，缺这些文件（先 npm run build）：')
  for (const p of missing) console.error(`  - ${p}`)
  process.exit(1)
}

if (!files['skins-inbox/README.txt']) {
  console.warn('! skins-inbox/README.txt 没进包，用户会看到一个空文件夹')
}

const zipped = zipSync(files, { level: 6 })
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, zipped)

const mb = (n) => (n / 1024 / 1024).toFixed(1)
console.log(`完成：${relative(ROOT, OUT)}  ${mb(zipped.length)} MB · ${Object.keys(files).length} 个文件`)
