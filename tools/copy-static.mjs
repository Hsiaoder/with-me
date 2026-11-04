/**
 * 构建的收尾步骤：把不参与 TypeScript 编译的静态文件搬到 dist。
 * 没有打包器（见 docs/架构大纲.md 第 4 节）——tsc 只搬 .js，
 * html/css 和零 import 的 preload 靠这里复制。
 */
import { copyFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// .png 不能漏：气泡底图是 png。上一轮栽在 app:// 的 MIME 白名单，这次栽在复制白名单——
// 文件躺在仓库里不等于进得了 dist，两道白名单都得过。
const STATIC_EXT = ['.html', '.css', '.svg', '.png']
const COPIES = [
  ['src/preload/index.cjs', 'dist/preload/index.cjs'],
]

/**
 * 递归搬：图标放在 src/renderer/icons/，页面按相对路径引用，目录结构必须原样保留。
 * 顺手返回搬了哪些相对路径，给 pruneOrphans 当「应该存在」的清单。
 */
function copyDir(srcDir, outDir, rel = '') {
  if (!existsSync(srcDir)) return { n: 0, kept: new Set() }
  mkdirSync(outDir, { recursive: true })
  let n = 0
  const kept = new Set()
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const full = join(srcDir, entry.name)
    const dest = join(outDir, entry.name)
    const key = join(rel, entry.name)
    if (entry.isDirectory()) {
      const sub = copyDir(full, dest, key)
      n += sub.n
      for (const k of sub.kept) kept.add(k)
      continue
    }
    if (STATIC_EXT.some((ext) => entry.name.endsWith(ext))) {
      copyFileSync(full, dest)
      kept.add(key)
      n++
    }
  }
  return { n, kept }
}

/**
 * 删掉 dist 里源文件已经不在的静态文件。
 * 只复制不清理的话，删一个图标它会一直留在 dist 里——下一轮改图标时，
 * dist 里躺着的旧素材会让人以为「还在用」，而 app:// 也真的还能把它取出来。
 * 只动这个工具自己管的那几种后缀，别的文件不碰。
 */
function pruneOrphans(outDir, kept, rel = '') {
  if (!existsSync(outDir)) return 0
  let removed = 0
  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    const full = join(outDir, entry.name)
    const key = join(rel, entry.name)
    if (entry.isDirectory()) {
      removed += pruneOrphans(full, kept, key)
      // 目录空了就一起收掉，留个空壳同样骗人
      if (readdirSync(full).length === 0) rmSync(full, { recursive: true })
      continue
    }
    if (!STATIC_EXT.some((ext) => entry.name.endsWith(ext))) continue
    if (kept.has(key)) continue
    rmSync(full)
    removed++
  }
  return removed
}

const { n: rendererCopied, kept } = copyDir('src/renderer', 'dist/renderer')
const pruned = pruneOrphans('dist/renderer', kept)
for (const [from, to] of COPIES) {
  if (!existsSync(from)) {
    console.error(`copy-static: 缺少 ${from}`)
    process.exitCode = 1
    continue
  }
  mkdirSync(to.slice(0, to.lastIndexOf('/')), { recursive: true })
  copyFileSync(from, to)
}
console.log(`copy-static: 静态文件 ${rendererCopied} 个，复制项 ${COPIES.length} 个，清掉源里已删除的 ${pruned} 个`)
