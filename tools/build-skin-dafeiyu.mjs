/**
 * 装配大肥鱼皮肤包：本地试穿皮肤 → build/skin/dafeiyu → release/with-me-skin-dafeiyu-<版本>.zip
 *
 * 素材**不进 git**（CC BY-NC-SA，且原片是上游 dsh-pet 的资产），所以这个脚本只能在本地跑，
 * 产出的 zip 用 `gh release upload` 手工补挂到 Release 上（CI 拿不到素材）。
 * 判据本身（manifest 换字、片段齐不齐）在 src/shared/skin-pack.ts，那里有单测。
 *
 * 用法：npm run skin:pack （= 先 build 再装配）
 *      直接跑也可以：node tools/build-skin-dafeiyu.mjs
 * 源目录优先级：--from= → 环境变量 SKIN_SRC → %TEMP%\dsh-asar-BHUAA9\pet\skins\dshtry
 *
 * 为什么 import 的是 `dist/` 而不是 `src/...ts`：skin-pack 要拉 animation / guess / skin 三个模块，
 * 它们内部用的是 `.js` 说明符（tsc 的 ESM 写法），Node 的类型剥离不做 .js→.ts 重定向，
 * 直接 import 源文件会 ERR_MODULE_NOT_FOUND。仓库里其它工具能 import src，
 * 是因为它们只碰 config.ts / licenses.ts 这种自身没有内部 import 的模块。
 * 走 dist 还多一层好处：装出来的包用的就是将要发布的那份编译产物。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

const SHARED = join(ROOT, 'dist', 'shared', 'skin-pack.js')
if (!existsSync(SHARED)) {
  console.error(`缺 ${SHARED}\n先跑 npm run build（或直接 npm run skin:pack）。`)
  process.exit(1)
}
const { DAFEIYU_ID, missingClipFiles, missingProductClips, packManifest } = await import(pathToFileURL(SHARED).href)

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const fromArg = process.argv.find((a) => a.startsWith('--from='))?.slice(7)
const SRC = fromArg ?? process.env.SKIN_SRC ?? join(tmpdir(), 'dsh-asar-BHUAA9', 'pet', 'skins', 'dshtry')
const OUT = join(ROOT, 'build', 'skin', DAFEIYU_ID)
const ZIP = join(ROOT, 'release', `with-me-skin-dafeiyu-${version}.zip`)
const TEXTS = ['ATTRIBUTION.md', 'INSTALL.txt', 'LICENSE-CC-BY-NC-SA.txt']

const die = (msg) => {
  console.error(msg)
  process.exit(1)
}

// 先验三件事再动手：源皮肤、三份随包文本、目标位置。
// 顺序很重要——OUT 会被重建，正文要是只存在 OUT 里，每次跑都得重新联网拉一遍。
if (!existsSync(join(SRC, 'manifest.json'))) {
  die(`找不到源皮肤：${SRC}\n用 --from=<目录> 指过去（目录里要有 manifest.json）。`)
}
if (!existsSync(join(SRC, 'animation'))) die(`源皮肤缺 animation 目录：${join(SRC, 'animation')}`)
for (const f of TEXTS) {
  if (!existsSync(join(ROOT, 'packs', DAFEIYU_ID, f))) {
    die(`缺 ${join('packs', DAFEIYU_ID, f)}（三份文本一份都不能少）`)
  }
}

// 1) 换 manifest：不合法就不出包，别先拷 37MB 再失败
const packed = packManifest(JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8')))
if (!packed.ok) die('manifest 没过皮肤契约，不出包：\n  ' + packed.errors.join('\n  '))

// 2) 产品会按名点的片段齐不齐（名单从 animation.ts / guess.ts 推导）
const missing = missingProductClips(packed.manifest.pools)
if (missing.length) {
  die(`缺 ${missing.length} 条产品会按名点的片段，出包后会静默退化成回落动画：\n  ${missing.join('\n  ')}`)
}

// 2.5) manifest 写了名字，磁盘上还得真有这一段。
// 漏了这条会拿一个空 animation 目录「成功」出一个几百字节的 zip 并把上一个真包覆盖掉（实测踩过）。
const missingFiles = missingClipFiles(packed.manifest.pools,
  (pool, name) => existsSync(join(SRC, 'animation', pool, `${name}.webm`)))
if (missingFiles.length) {
  die(`源皮肤缺 ${missingFiles.length} 个素材文件，不出包（源目录：${SRC}）：\n  ${missingFiles.slice(0, 12).join('\n  ')}`)
}

// 3) 装配：素材一个字节不动
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
cpSync(join(SRC, 'animation'), join(OUT, 'animation'), { recursive: true })
writeFileSync(join(OUT, 'manifest.json'), packed.json)
for (const f of TEXTS) cpSync(join(ROOT, 'packs', DAFEIYU_ID, f), join(OUT, f))

const clipCount = (dir) =>
  readdirSync(dir, { recursive: true }).filter((p) => String(p).endsWith('.webm') &&
    statSync(join(dir, String(p))).isFile()).length
const clips = clipCount(join(OUT, 'animation'))

// 4) 压 zip：PowerShell 的 Compress-Archive，本机现成，不为一个出包脚本再引依赖。
//    压缩包顶层留一层 dafeiyu/，跟 INSTALL.txt 里「整个目录放进 skins\」的说法对齐。
mkdirSync(join(ROOT, 'release'), { recursive: true })
rmSync(ZIP, { force: true })
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -LiteralPath '${OUT}' -DestinationPath '${ZIP}' -Force`,
])

console.log(`出包：${ZIP}`)
console.log(`  ${clips} 段原片 · ${packed.manifest.name} · id=${DAFEIYU_ID}`)
console.log(`  zip ${(statSync(ZIP).size / 1024 / 1024).toFixed(1)} MB`)
