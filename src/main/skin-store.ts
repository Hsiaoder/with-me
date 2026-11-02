import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ANIMATION_EXT, SKIN_ANIMATION_DIR, SKIN_MANIFEST } from '../shared/config.js'
import {
  missingRequiredPools,
  validateManifest,
  type LoadResult,
  type SkinManifest,
} from '../shared/skin.js'

/**
 * 皮肤装载：读目录 → 校验 manifest → 确认每条素材文件真的在。
 *
 * 透明通道体检**不在这里做**。它要调 ffmpeg 解码，而 `ffmpeg-static` 是开发依赖，
 * 生产代码不许依赖它（也不该为体检多背几十 MB）。体检是交付前的闸门，
 * 跑 `npm run alpha:check`，见皮肤契约 spec 第 5 节。
 *
 * LoadedSkin / LoadResult 定义在 shared/skin.ts：渲染层要通过 IPC 拿它们，
 * 而分层铁律不许 renderer import main。
 */

/** 素材必须是普通文件。existsSync 会让一个叫 `left.webm` 的**目录**混过关。 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** 某条动画在磁盘上的位置。 */
export function clipFile(skinDir: string, pool: string, name: string): string {
  return join(skinDir, SKIN_ANIMATION_DIR, pool, `${name}${ANIMATION_EXT}`)
}

/** 素材相对路径，出现在错误信息里时比绝对路径好读。 */
const relOf = (pool: string, name: string): string =>
  `${SKIN_ANIMATION_DIR}/${pool}/${name}${ANIMATION_EXT}`

export function loadSkin(rawDir: string): LoadResult {
  // 目录转绝对：后面要拿它跟 dist 拼协议资源根，相对路径过一次 IPC 就废了
  const dir = resolve(rawDir)
  const manifestPath = join(dir, SKIN_MANIFEST)

  let text: string
  try {
    text = readFileSync(manifestPath, 'utf8')
  } catch {
    return { ok: false, errors: [`找不到皮肤清单：${manifestPath}`] }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, errors: [`皮肤清单不是合法 JSON：${(e as Error).message}`] }
  }

  const checked = validateManifest(raw)
  if (!checked.ok) return { ok: false, errors: checked.errors }

  const gaps = missingRequiredPools(checked.manifest)
  if (gaps.length) return { ok: false, errors: [`缺少必需动画池：${gaps.join('、')}`] }

  const errors: string[] = []
  const pools: Record<string, string[]> = {}
  for (const [pool, names] of Object.entries(checked.manifest.pools)) {
    pools[pool] = names.filter((name) => {
      if (isFile(clipFile(dir, pool, name))) return true
      errors.push(`找不到素材文件：${relOf(pool, name)}`)
      return false
    })
  }

  // 缺文件被剔掉之后，必需池有可能被掏空——这等于缺池，不能放行
  const emptied = missingRequiredPools({ ...checked.manifest, pools })
  if (emptied.length) errors.push(`必需池里没有一条素材真正存在：${emptied.join('、')}`)

  if (errors.length) return { ok: false, errors }
  return { ok: true, skin: { dir, manifest: checked.manifest, pools } }
}
