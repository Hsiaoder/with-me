import { ANIMATION_EXT, CANVAS_H, CANVAS_W, LOOPING_POOLS, REQUIRED_POOLS, SKIN_ORIGIN } from './config.js'
import type { Box } from './types.js'

/**
 * 皮肤 manifest 的契约与校验。规则的文字版本在
 * `docs/superpowers/specs/2026-11-02-skin-pack-contract.md`，改这里要同步改那份。
 *
 * 纯函数：不读盘、不碰 Electron，所以每一条拒绝理由都能被单测钉住。
 */

/** 作者写的原始元数据，字段都可省略，缺省由 isLooping / isMirrorable 补。 */
export type AnimationMeta = { loop?: boolean; mirrorable?: boolean; bodyBox?: Box }

export type SkinManifest = {
  formatVersion: number
  name: string
  author?: string
  canvas: { w: number; h: number; feetY: number }
  bodyBox: Box
  pools: Record<string, string[]>
  weights?: Record<string, number>
  animationMeta?: Record<string, AnimationMeta>
  hotspots?: Record<string, Box>
}

export type ValidationResult = { ok: true; manifest: SkinManifest } | { ok: false; errors: string[] }

/**
 * 装载成功的皮肤。类型放这里而不是 main/skin-store，因为渲染层要通过 IPC 拿到它——
 * 分层铁律不许 renderer import main。
 */
export type LoadedSkin = {
  /** 绝对路径。渲染层拿它拼不出地址，地址一律走 clipUrl。 */
  dir: string
  manifest: SkinManifest
  /** 池名 → 校验通过的动画名。 */
  pools: Record<string, string[]>
}

export type LoadResult = { ok: true; skin: LoadedSkin } | { ok: false; errors: string[] }

/**
 * 发给渲染层的形状。刻意不带 `dir`：渲染层用 clipUrl 就够，
 * 没必要知道本机绝对目录——少一份泄露出去的数据，也少一处将来会被误用的入口。
 *
 * `warnings` 是「能跑但有情况」的通道：皮肤找不到、旧档回退之类，
 * 要显示出来而不是静默处理（编码规则 15）。
 */
export type SkinPayload = { manifest: SkinManifest; pools: Record<string, string[]>; warnings: string[] }
export type SkinErrorPayload = { errors: string[]; warnings: string[] }

export const toSkinPayload = (skin: LoadedSkin, warnings: string[] = []): SkinPayload => ({
  manifest: skin.manifest,
  pools: skin.pools,
  warnings,
})

const SUPPORTED_FORMAT = 1
/** 池名与动画名要拼进文件路径和 URL，所以只放最安全的字符集。契约 3.3。 */
const POOL_NAME = /^[a-z][a-z0-9_-]{0,31}$/
const CLIP_NAME = /^[a-z][a-z0-9_-]{0,39}$/
const NAME_HINT = '只允许小写字母开头的 a-z0-9_- '

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** 矩形：宽高至少 1，且完整落在画布内。出框的命中区会让鼠标停在看不见的身上没反应。 */
function checkBox(v: unknown, where: string, errors: string[]): Box | null {
  if (!isObj(v)) {
    errors.push(`${where} 缺失或不是对象`)
    return null
  }
  const { x, y, w, h } = v
  if (!isInt(x, 0, CANVAS_W) || !isInt(y, 0, CANVAS_H) || !isInt(w, 1, CANVAS_W) || !isInt(h, 1, CANVAS_H)) {
    errors.push(`${where} 的 x/y/w/h 必须是整数，且宽高至少 1`)
    return null
  }
  if (x + w > CANVAS_W || y + h > CANVAS_H) {
    errors.push(`${where} 越出 ${CANVAS_W}x${CANVAS_H} 画布`)
    return null
  }
  return { x, y, w, h }
}

/**
 * 一次收齐全部错误再返回。作者改 manifest 时最想看到的是「你一共有这几处不对」，
 * 而不是改一个报一个。
 */
export function validateManifest(raw: unknown): ValidationResult {
  const errors: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['manifest 不是一个对象'] }

  if (raw.formatVersion !== SUPPORTED_FORMAT) {
    errors.push(`不支持的皮肤格式版本 formatVersion=${String(raw.formatVersion)}，本程序支持 ${SUPPORTED_FORMAT}`)
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') errors.push('name 必填且要写成字符串')
  if (raw.author !== undefined && typeof raw.author !== 'string') errors.push('author 要写成字符串')

  const canvas = raw.canvas
  let feetY: number | null = null
  if (!isObj(canvas)) {
    errors.push('canvas 缺失或不是对象')
  } else {
    if (canvas.w !== CANVAS_W || canvas.h !== CANVAS_H) {
      errors.push(`画布尺寸必须是 ${CANVAS_W}x${CANVAS_H}，实际 ${String(canvas.w)}x${String(canvas.h)}`)
    }
    if (isInt(canvas.feetY, 1, CANVAS_H - 1)) feetY = canvas.feetY
    else errors.push(`canvas.feetY 必须是 1 到 ${CANVAS_H - 1} 的整数，脚底要真的落在画面内`)
  }

  const bodyBox = checkBox(raw.bodyBox, 'bodyBox', errors)

  const pools: Record<string, string[]> = {}
  if (!isObj(raw.pools)) {
    errors.push('pools 缺失或不是对象')
  } else {
    for (const [pool, list] of Object.entries(raw.pools)) {
      if (!POOL_NAME.test(pool)) errors.push(`池名「${pool}」不合法：${NAME_HINT}，最长 32`)
      if (!Array.isArray(list)) {
        errors.push(`pools.${pool} 不是动画名数组`)
        continue
      }
      if (list.length === 0) errors.push(`pools.${pool} 是空池`)
      const names: string[] = []
      for (const n of list) {
        if (typeof n !== 'string' || !CLIP_NAME.test(n)) {
          errors.push(`pools.${pool} 含非法动画名 ${JSON.stringify(n)}：${NAME_HINT}，最长 40`)
          continue
        }
        names.push(n)
      }
      pools[pool] = names
    }
  }

  if (raw.weights !== undefined) {
    if (!isObj(raw.weights)) errors.push('weights 不是对象')
    else {
      for (const [pool, weight] of Object.entries(raw.weights)) {
        if (!(pool in pools)) errors.push(`weights.${pool} 指向 pools 里不存在的池`)
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
          errors.push(`weights.${pool} 必须是正数`)
        }
      }
    }
  }

  const knownClips = new Set(Object.values(pools).flat())
  if (raw.animationMeta !== undefined) {
    if (!isObj(raw.animationMeta)) errors.push('animationMeta 不是对象')
    else {
      for (const [name, meta] of Object.entries(raw.animationMeta)) {
        if (!knownClips.has(name)) errors.push(`animationMeta.${name} 在 pools 里找不到对应动画`)
        if (!isObj(meta)) {
          errors.push(`animationMeta.${name} 不是对象`)
          continue
        }
        if (meta.loop !== undefined && !isBool(meta.loop)) errors.push(`animationMeta.${name}.loop 必须是 true/false`)
        if (meta.mirrorable !== undefined && !isBool(meta.mirrorable)) {
          errors.push(`animationMeta.${name}.mirrorable 必须是 true/false`)
        }
        if (meta.bodyBox !== undefined) checkBox(meta.bodyBox, `animationMeta.${name}.bodyBox`, errors)
      }
    }
  }

  if (raw.hotspots !== undefined) {
    if (!isObj(raw.hotspots)) errors.push('hotspots 不是对象')
    else for (const [key, box] of Object.entries(raw.hotspots)) checkBox(box, `hotspots.${key}`, errors)
  }

  if (errors.length || !feetY || !bodyBox) return { ok: false, errors }

  const manifest: SkinManifest = {
    formatVersion: SUPPORTED_FORMAT,
    name: (raw.name as string).trim(),
    canvas: { w: CANVAS_W, h: CANVAS_H, feetY },
    bodyBox,
    pools,
  }
  if (typeof raw.author === 'string' && raw.author.trim()) manifest.author = raw.author.trim()
  if (isObj(raw.weights)) {
    manifest.weights = Object.fromEntries(Object.entries(raw.weights).map(([k, v]) => [k, v as number]))
  }
  if (isObj(raw.animationMeta)) manifest.animationMeta = raw.animationMeta as Record<string, AnimationMeta>
  if (isObj(raw.hotspots)) manifest.hotspots = raw.hotspots as Record<string, Box>
  return { ok: true, manifest }
}

/** 拒绝装载用：返回缺失的必需池名。空池等同于缺。 */
export function missingRequiredPools(manifest: SkinManifest): string[] {
  return REQUIRED_POOLS.filter((pool) => (manifest.pools[pool]?.length ?? 0) === 0)
}

/** 循环性属于单条动画，缺省按所在池名给：状态性池挂着，反应性池播完就回待机。 */
export function isLooping(manifest: SkinManifest, pool: string, name: string): boolean {
  return manifest.animationMeta?.[name]?.loop ?? (LOOPING_POOLS as readonly string[]).includes(pool)
}

/** 缺省不镜像。左右是两回事，擅自翻转等于替作者改了动作方向。 */
export function isMirrorable(manifest: SkinManifest, name: string): boolean {
  return manifest.animationMeta?.[name]?.mirrorable ?? false
}

/** 该动画的实际身体框：作者没覆盖就用皮肤默认框。轮廓剧变的动作必须覆盖。 */
export function bodyBoxOf(manifest: SkinManifest, name: string): Box {
  return manifest.animationMeta?.[name]?.bodyBox ?? manifest.bodyBox
}

/** 素材地址。主进程注册的 skin 根指向皮肤目录下的 animation/，所以这里不再带该前缀。 */
export function clipUrl(pool: string, name: string): string {
  return `${SKIN_ORIGIN}${pool}/${name}${ANIMATION_EXT}`
}
