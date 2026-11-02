/**
 * 从实现计划与功能规格派生 docs/实现进度.md。
 *
 * 为什么要生成而不是手写：打勾的地方有两处（计划的任务步骤、规格的验收清单），
 * 手写一份第三处的清单，第一次打勾就开始漂移。这个脚本只读那两个源文件。
 *
 * 用法：node tools/progress.mjs          重新生成
 *      node tools/progress.mjs --check  只报告是否与源文件一致（给 CI 用）
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLAN = join(ROOT, 'docs/superpowers/plans/2026-11-02-desktop-pet-v1.md')
const SPEC = join(ROOT, 'docs/superpowers/specs/2026-11-02-desktop-pet-v1.md')
const OUT = join(ROOT, 'docs/实现进度.md')

const CHECKBOX = /^- \[([ x])\] \*\*(.+?)\*\*/
const TASK = /^## (Task \d+: .+)$/

/** 按标题行切段，返回该标题之后、下一个同级标题之前的内容。 */
function section(md, heading) {
  const start = md.indexOf(heading)
  if (start < 0) return ''
  const rest = md.slice(start + heading.length)
  const next = rest.search(/^## /m)
  return next < 0 ? rest : rest.slice(0, next)
}

function parseTasks(plan) {
  const lines = plan.split('\n')
  const tasks = []
  let current = null
  for (const line of lines) {
    const t = TASK.exec(line)
    if (t) {
      current = { title: t[1], steps: [] }
      tasks.push(current)
      continue
    }
    if (/^## (Global Constraints|前置|验收)/.test(line)) current = null
    const c = CHECKBOX.exec(line)
    if (c && current) current.steps.push({ done: c[1] === 'x', title: c[2] })
  }
  return tasks.filter((t) => t.steps.length > 0)
}

/** 规格第 7 节的验收清单：按 **自动化** / **真机** 分组。 */
function parseAcceptance(spec) {
  const body = section(spec, '## 7. 验收标准')
  const groups = []
  let current = null
  for (const line of body.split('\n')) {
    const g = /^\*\*(.+?)\*\*\s*$/.exec(line)
    if (g) {
      current = { label: g[1], items: [] }
      groups.push(current)
      continue
    }
    const c = /^- \[([ x])\] (.+)$/.exec(line)
    if (c && current) current.items.push({ done: c[1] === 'x', title: c[2] })
  }
  return groups.filter((g) => g.items.length > 0)
}

const bar = (done, total) => {
  const filled = total === 0 ? 0 : Math.round((done / total) * 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

const plan = readFileSync(PLAN, 'utf8')
const spec = readFileSync(SPEC, 'utf8')
const tasks = parseTasks(plan)
const acceptance = parseAcceptance(spec)

const totalSteps = tasks.reduce((n, t) => n + t.steps.length, 0)
const doneSteps = tasks.reduce((n, t) => n + t.steps.filter((s) => s.done).length, 0)
const accItems = acceptance.flatMap((g) => g.items)
const accDone = accItems.filter((i) => i.done).length

let head = 'short HEAD'
let sha = '?'
try {
  sha = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()
} catch {
  head = 'unavailable'
}

const out = `# 实现进度

> **本文件由 \`node tools/progress.mjs\` 从实现计划与功能规格派生，不要手工编辑。**
> 打勾请改源文件：任务步骤改 [实现计划](superpowers/plans/2026-11-02-desktop-pet-v1.md)，验收项改 [功能规格](superpowers/specs/2026-11-02-desktop-pet-v1.md) 第 7 节，然后重跑生成命令。
> 手写这份清单只会让三处状态互相矛盾——这正是要避免的。

| 项 | 值 |
|---|---|
| 任务步骤 | ${bar(doneSteps, totalSteps)} ${doneSteps}/${totalSteps} |
| 验收清单 | ${bar(accDone, accItems.length)} ${accDone}/${accItems.length} |
| 生成时 HEAD | \`${sha}\` |

## 任务一览

| 任务 | 步骤 | 状态 |
|---|---|---|
${tasks.map((t) => {
  const d = t.steps.filter((s) => s.done).length
  const mark = d === t.steps.length ? '完成' : d === 0 ? '未开始' : '进行中'
  return `| ${t.title} | ${d}/${t.steps.length} | ${mark} |`
}).join('\n')}

## 步骤明细

${tasks.map((t) => {
  const d = t.steps.filter((s) => s.done).length
  const head2 = d === t.steps.length ? '✅' : d === 0 ? '⬜' : '🔶'
  return `### ${head2} ${t.title}　${d}/${t.steps.length}

${t.steps.map((s) => `- [${s.done ? 'x' : ' '}] ${s.title}`).join('\n')}`
}).join('\n\n')}

## v1 验收清单

${acceptance.map((g) => `### ${g.label}

${g.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.title}`).join('\n')}`).join('\n\n')}
`

if (process.argv.includes('--check')) {
  const prev = readFileSync(OUT, 'utf8').replace(/^(\| 生成时 HEAD \| `)[^`]+(` \|)/m, '$1?$2')
  const now = out.replace(/^(\| 生成时 HEAD \| `)[^`]+(` \|)/m, '$1?$2')
  if (prev === now) {
    console.log('进度文件与源文件一致')
  } else {
    console.error('进度文件已过期，跑 node tools/progress.mjs 重新生成')
    process.exitCode = 1
  }
} else {
  writeFileSync(OUT, out)
  console.log(`docs/实现进度.md 已生成：步骤 ${doneSteps}/${totalSteps}，验收 ${accDone}/${accItems.length}`)
}
