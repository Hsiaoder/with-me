import { app } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/**
 * 路径的唯一出口。macOS 迁移时只改这个文件。
 * 不许在别处硬编码 `%APPDATA%` 或 `~/.config`。
 */

/** win32: `%APPDATA%\<app>`；darwin: `~/Library/Application Support/<app>`。 */
export function platformDataDir(): string {
  return app.getPath('userData')
}

/** 随应用发布的内置皮肤目录。 */
export function builtinSkinsDir(): string {
  return join(app.getAppPath(), 'skins')
}

/** 用户自己放皮肤的目录，优先级高于内置：同名时用户的那份赢。 */
export function userSkinsDir(): string {
  return join(platformDataDir(), 'skins')
}

/** 皮肤 id 的合法形状。目录名与存档里的 skin 字段共用这一条。 */
const SKIN_ID = /^[a-z][a-z0-9_-]{0,63}$/

/**
 * 按皮肤 id 找目录。id 会拼进路径，所以先挡掉任何形式的路径分隔与穿越；
 * 解析结果还必须真的落在某个皮肤根里，否则一律当作找不到。
 */
export function findSkinDir(id: string): string | null {
  if (!SKIN_ID.test(id)) return null
  for (const root of [userSkinsDir(), builtinSkinsDir()]) {
    const candidate = resolve(join(root, id))
    if (candidate !== root && !candidate.startsWith(root + sep)) continue
    if (existsSync(join(candidate, 'manifest.json'))) return candidate
  }
  return null
}

/** 找不到指定皮肤时的兜底目标——仍然要显式报一条警告，不许静默换。 */
export const FALLBACK_SKIN = 'block'

export type SkinEntry = { id: string; dir: string }

/**
 * 列出所有可选皮肤：用户目录优先，同名时只留用户那份；没有 manifest.json 的目录不算。
 * 托盘菜单靠它列皮肤，不读存档、不猜名字。
 */
export function listSkinDirs(): SkinEntry[] {
  const out: SkinEntry[] = []
  const seen = new Set<string>()
  for (const root of [userSkinsDir(), builtinSkinsDir()]) {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const id of names) {
      if (!SKIN_ID.test(id) || seen.has(id)) continue
      const dir = join(root, id)
      if (existsSync(join(dir, 'manifest.json'))) {
        seen.add(id)
        out.push({ id, dir })
      }
    }
  }
  return out
}
