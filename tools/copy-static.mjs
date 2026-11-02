/**
 * 构建的收尾步骤：把不参与 TypeScript 编译的静态文件搬到 dist。
 * 没有打包器（见 docs/架构大纲.md 第 4 节）——tsc 只搬 .js，
 * html/css 和零 import 的 preload 靠这里复制。
 */
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const STATIC_EXT = ['.html', '.css']
const COPIES = [
  ['src/preload/index.cjs', 'dist/preload/index.cjs'],
]

function copyDir(srcDir, outDir) {
  if (!existsSync(srcDir)) return 0
  mkdirSync(outDir, { recursive: true })
  let n = 0
  for (const name of readdirSync(srcDir)) {
    const full = join(srcDir, name)
    if (STATIC_EXT.some((ext) => name.endsWith(ext))) {
      copyFileSync(full, join(outDir, name))
      n++
    }
  }
  return n
}

const rendererCopied = copyDir('src/renderer', 'dist/renderer')
for (const [from, to] of COPIES) {
  if (!existsSync(from)) {
    console.error(`copy-static: 缺少 ${from}`)
    process.exitCode = 1
    continue
  }
  mkdirSync(to.slice(0, to.lastIndexOf('/')), { recursive: true })
  copyFileSync(from, to)
}
console.log(`copy-static: 静态文件 ${rendererCopied} 个，复制项 ${COPIES.length} 个`)
