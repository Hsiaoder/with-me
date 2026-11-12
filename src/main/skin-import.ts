import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { missingClipFiles } from '../shared/skin-pack.js'
import { missingRequiredPools, validateManifest, type SkinManifest } from '../shared/skin.js'

/**
 * 用户自己选的皮肤包导入。
 *
 * 边界全在这里收：压缩包不可信，路径穿越、绝对路径、zip 炸弹、可执行文件都在解压前挡掉。
 * manifest 的语义校验复用 shared/skin.ts，缺片段复用 shared/skin-pack.ts——不另造一套标准。
 */

export const MAX_ZIP_BYTES = 256 * 1024 * 1024
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024
export const MAX_ENTRIES = 4000

const SKIN_ID = /^[a-z][a-z0-9_-]{0,63}$/
const ALLOWED_EXT = new Set([
  '.json', '.webm', '.md', '.txt', '.png', '.jpg', '.jpeg', '.svg', '.woff2', '.mp3', '.ogg',
])

export type SkinPack = {
  id: string
  manifest: SkinManifest
  license?: string
  attribution?: string
  /** 相对皮肤根目录的路径（已去掉顶层目录名）。 */
  files: Record<string, Uint8Array>
}

export type InspectResult = { ok: true; pack: SkinPack } | { ok: false; error: string }
export type InstallResult = { ok: true; id: string; manifest: SkinManifest } | { ok: false; error: string }

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/** 统一成 `/` 分隔，去掉开头的 `./` 和结尾的 `/`；目录项返回 'dir'。非法路径直接抛。 */
function cleanPath(raw: string): string | 'dir' {
  const trimmed = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  if (trimmed === '') return 'dir'
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed) || trimmed.includes('\0')) {
    throw new Error(`皮肤包含非法路径：${raw}`)
  }
  const parts = trimmed.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`皮肤包含非法路径：${raw}`)
  }
  const dot = trimmed.lastIndexOf('.')
  const ext = dot >= 0 ? trimmed.slice(dot).toLowerCase() : ''
  if (!ALLOWED_EXT.has(ext)) throw new Error(`皮肤包含不支持的文件类型：${raw}`)
  return trimmed
}

export function inspectSkinPack(zip: Uint8Array): InspectResult {
  if (zip.length === 0) return fail('皮肤包是空文件')
  if (zip.length > MAX_ZIP_BYTES) return fail('皮肤包过大（超过 256MB）')

  let entries: Record<string, Uint8Array>
  try {
    let total = 0
    let count = 0
    entries = unzipSync(zip, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false
        cleanPath(f.name)
        if (++count > MAX_ENTRIES) throw new Error('皮肤包文件数量过多')
        total += f.originalSize
        if (total > MAX_TOTAL_BYTES) throw new Error('皮肤包解压后体积过大')
        return true
      },
    })
  } catch (e) {
    return fail(e instanceof Error ? e.message : '皮肤包无法解压')
  }

  const files: Record<string, Uint8Array> = {}
  try {
    for (const [name, data] of Object.entries(entries)) {
      const clean = cleanPath(name)
      if (clean !== 'dir') files[clean] = data
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : '皮肤包包含非法路径')
  }

  // 顶层必须只有一个目录；多套一层（用户把文件夹再压一次）自动往里走，最多两层。
  const names = Object.keys(files)
  if (names.length === 0) return fail('皮肤包里没有任何文件')
  if (names.includes('manifest.json')) return fail('请把皮肤文件放进一个目录后再压缩，目录名就是皮肤 id')
  if (!names.some((n) => n.endsWith('/manifest.json'))) return fail('皮肤包里找不到 manifest.json')

  let prefix = ''
  for (let depth = 0; depth < 3; depth += 1) {
    if (files[`${prefix}manifest.json`] !== undefined) break
    const tops = new Set(names.map((n) => n.slice(prefix.length).split('/')[0]))
    if (tops.size !== 1) return fail('皮肤包顶层必须只有一个目录')
    prefix += `${[...tops][0]}/`
  }
  if (files[`${prefix}manifest.json`] === undefined) return fail('皮肤包里找不到 manifest.json')

  const id = prefix.split('/').filter(Boolean).pop() ?? ''
  if (!SKIN_ID.test(id)) return fail(`皮肤目录名不合法：${id}（只允许小写字母、数字、_、-）`)

  let raw: unknown
  try {
    raw = JSON.parse(strFromU8(files[`${prefix}manifest.json`]!))
  } catch {
    return fail('manifest.json 不是合法 JSON')
  }
  const checked = validateManifest(raw)
  if (!checked.ok) return fail(`manifest 校验失败：\n${checked.errors.join('\n')}`)
  const missingPools = missingRequiredPools(checked.manifest)
  if (missingPools.length > 0) return fail(`皮肤缺少必需动作池：${missingPools.join('、')}`)

  const relative: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(files)) {
    if (name.startsWith(prefix)) relative[name.slice(prefix.length)] = data
  }

  const missing = missingClipFiles(checked.manifest.pools, (pool, name) =>
    relative[`animation/${pool}/${name}.webm`] !== undefined)
  if (missing.length > 0) {
    return fail(`皮肤包缺少 ${missing.length} 个动画文件：\n${missing.slice(0, 8).join('\n')}`)
  }

  const meta = raw as Record<string, unknown>
  const pack: SkinPack = { id, manifest: checked.manifest, files: relative }
  if (typeof meta.license === 'string') pack.license = meta.license
  if (typeof meta.attribution === 'string') pack.attribution = meta.attribution
  return { ok: true, pack }
}

/** 解压到 `skinsRoot/<id>`。先写临时目录再整体换名，失败不会留下半个皮肤。 */
export function installSkinPack(zip: Uint8Array, skinsRoot: string): InstallResult {
  const inspected = inspectSkinPack(zip)
  if (!inspected.ok) return inspected

  const { id, manifest, files } = inspected.pack
  const root = resolve(skinsRoot)
  const target = join(root, id)
  const temp = join(root, `.import-${process.pid}-${Date.now()}`)
  const backup = `${target}.old`

  try {
    mkdirSync(temp, { recursive: true })
    for (const [rel, data] of Object.entries(files)) {
      const dest = resolve(temp, rel)
      if (dest !== temp && !dest.startsWith(temp + sep)) throw new Error(`非法路径：${rel}`)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, data)
    }

    mkdirSync(root, { recursive: true })
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true })
    if (existsSync(target)) renameSync(target, backup)
    try {
      renameSync(temp, target)
    } catch (e) {
      if (existsSync(backup) && !existsSync(target)) renameSync(backup, target)
      throw e
    }
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true })
    return { ok: true, id, manifest }
  } catch (e) {
    try { rmSync(temp, { recursive: true, force: true }) } catch { /* 清理失败不掩盖原错误 */ }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
