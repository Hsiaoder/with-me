/**
 * 许可闸门：跑在 `npm run build` 之后，CI 与本地同一条命令。
 * 判据全在 src/shared/licenses.ts，这里只做读盘、分树投递与打印。
 *
 * 用法：node tools/check-licenses.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { auditAssets, findForbidden } from '../src/shared/licenses.ts'

const ROOT = process.cwd()

/** 素材后缀：登记与禁放都只看这些，源码 .ts/.css/.html 不归它管。 */
const ASSET_EXT = ['.webm', '.mp3', '.woff2', '.png', '.svg', '.jpg', '.gif', '.txt', '.ttf', '.otf', '.ico']
/** 登记完整性查源树：一处真相。dist 是源树的拷贝，往它身上登记等于把 CC0 盖成 GPL。 */
const SRC_TREES = ['src/renderer', 'skins', 'assets']
/** 禁放扫描查包树：将要进包与已经进包的东西。 */
const PACK_TREES = ['dist', 'skins', 'release', 'assets']

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else if (ASSET_EXT.some((e) => name.toLowerCase().endsWith(e))) {
      out.push(relative(ROOT, abs).split(sep).join('/'))
    }
  }
  return out
}

const collect = (trees) => {
  const out = []
  for (const t of trees) if (existsSync(join(ROOT, t))) walk(join(ROOT, t), out)
  return out
}

for (const required of ['LICENSE', 'NOTICE.md', 'licenses.json']) {
  if (!existsSync(join(ROOT, required))) {
    console.error(`缺 ${required}`)
    process.exit(1)
  }
}

const entries = JSON.parse(readFileSync(join(ROOT, 'licenses.json'), 'utf8'))
const findings = [
  ...findForbidden(collect(PACK_TREES)),
  ...auditAssets(entries, collect(SRC_TREES)),
]

if (findings.length === 0) {
  console.log(`许可闸门通过：${entries.length} 条登记，源树与包树都干净`)
  process.exit(0)
}
for (const f of findings) console.error(`✗ ${f.file} —— ${f.reason}`)
console.error(`共 ${findings.length} 条`)
process.exit(1)
