/**
 * 素材许可的两道判据。纯函数、不读盘——读盘交给 tools/check-licenses.mjs，
 * 这样「什么算合规」只有一处定义，CI 与本地不会长成两套标准。
 *
 * 两道判据分管两棵树（spec 第五节的 P0/P1/P2）：
 *   auditAssets    管源树（src/renderer、skins）：每一份素材都要有归属条目。
 *   findForbidden  管包树（dist、skins、release）：不该出现的东西一个都不许有。
 *
 * 为什么不合成一个函数：合成就会出现「把 dist/ 整目录登记成 GPL-3.0-only」这种假合规——
 * dist/renderer/icons 里那些 Kenney png 明明是 CC0，被一条 dist/ 条目盖过去，登记表就成废纸。
 * 登记只管源树（一处真相），禁放只管包树（dist 是源树的拷贝，出现形象素材说明有人误塞）。
 */

export type LicenseEntry = {
  /** 相对仓库根、用 `/` 分隔的路径。以 `/` 结尾表示整个目录。 */
  path: string
  /** SPDX 标识或一句话：CC0-1.0 / OFL-1.1 / GPL-3.0-only / 本项目自制。 */
  license: string
  /** 出处：作者或上游仓库。 */
  source: string
  note?: string
}

export type Finding = { file: string; reason: string }

/** 形象素材指纹：只能待在单独的皮肤包里，不许进主程序树（CC BY-NC-SA 与 GPL 不能进同一个作品）。 */
const CHARACTER = ['dafeiyu', 'dshtry', '大肥鱼']
/** GPL 作品里不许夹带的字样（GPLv3：you may not impose any further restrictions）。 */
const EXTRA = ['禁止商用', '非商业', 'non-commercial', 'by-nc']
/** 上游许可禁止再分发的来源。 */
const REDISTRIBUTION_BANNED = ['iconfont']
/** 只收子集化后的 woff2；散装字体一律不进包（整包嵌是另一套许可义务）。 */
const RAW_FONT_EXT = ['.ttf', '.otf']

const hit = (file: string, markers: readonly string[]): string | undefined =>
  markers.find((m) => file.toLowerCase().includes(m.toLowerCase()))

const covered = (file: string, entry: LicenseEntry): boolean =>
  entry.path.endsWith('/') ? file.startsWith(entry.path) : file === entry.path

/** 每个素材文件都要落进某条登记；反过来，登记了却没人命中的条目也算问题（表会烂掉）。 */
export function auditAssets(entries: readonly LicenseEntry[], files: readonly string[]): Finding[] {
  const findings: Finding[] = []
  const touched = new Set<string>()

  for (const file of files) {
    const hits = entries.filter((e) => covered(file, e))
    if (hits.length === 0) {
      findings.push({ file, reason: '没有登记到 licenses.json' })
      continue
    }
    hits.forEach((e) => touched.add(e.path))
  }
  for (const e of entries) {
    if (!touched.has(e.path)) findings.push({ file: e.path, reason: `登记了却没有任何文件命中：${e.path}` })
  }
  return findings
}

/** 包树里出现这些就是发布事故，逐条给出「为什么不许在」。 */
export function findForbidden(files: readonly string[]): Finding[] {
  const findings: Finding[] = []
  for (const file of files) {
    const character = hit(file, CHARACTER)
    if (character) {
      findings.push({ file, reason: `形象素材（${character}）混进了主程序树：它只能待在单独的皮肤包里` })
      continue
    }
    const extra = hit(file, EXTRA)
    if (extra) {
      findings.push({ file, reason: `文件名带「${extra}」＝额外限制，主程序按 GPL-3.0-only 发行不许加` })
      continue
    }
    const banned = hit(file, REDISTRIBUTION_BANNED)
    if (banned) {
      findings.push({ file, reason: `${banned} 素材：上游许可禁止再分发` })
      continue
    }
    if (RAW_FONT_EXT.some((ext) => file.toLowerCase().endsWith(ext))) {
      findings.push({ file, reason: '散装字体（只允许 woff2 子集进包）' })
    }
  }
  return findings
}
