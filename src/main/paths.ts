import { app } from 'electron'
import { existsSync } from 'node:fs'
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

/**
 * 按皮肤 id 找目录。id 会拼进路径，所以先挡掉任何形式的路径分隔与穿越；
 * 解析结果还必须真的落在某个皮肤根里，否则一律当作找不到。
 */
export function findSkinDir(id: string): string | null {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) return null
  for (const root of [userSkinsDir(), builtinSkinsDir()]) {
    const candidate = resolve(join(root, id))
    if (candidate !== root && !candidate.startsWith(root + sep)) continue
    if (existsSync(join(candidate, 'manifest.json'))) return candidate
  }
  return null
}

/** 找不到指定皮肤时的兜底目标——仍然要显式报一条警告，不许静默换。 */
export const FALLBACK_SKIN = 'block'
