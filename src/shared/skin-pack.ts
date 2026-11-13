import { ALL_CLIPS } from './animation.js'
import { ANIMATION_EXT } from './config.js'
import { GUESS_ACTIONS, GUESS_POOL } from './guess.js'
import { missingRequiredPools, validateManifest, type SkinManifest } from './skin.js'

/**
 * 大肥鱼皮肤包的发布逻辑：换 manifest + 核对产品片段齐不齐。
 *
 * 读盘、拷贝、压缩都在 tools/build-skin-dafeiyu.mjs——shared 层不碰 fs，
 * 这样「什么算一个能发的包」能被单测钉住，而不是只在跑脚本时才走一遍。
 * 规格的来处：docs/superpowers/specs/2026-11-11-release-packaging-design.md 第三节。
 */

/** 目录名要过 `src/main/paths.ts` 那条 `^[a-z][a-z0-9_-]{0,63}$`，所以固定 ascii。 */
export const DAFEIYU_ID = 'dafeiyu'

const NAME = '大肥鱼'
/** 上游要求二创在公开渠道附原作者地址，这条写进 manifest 让皮肤本身自带出处。 */
const AUTHOR = '形象与动画原片来自 dsh-pet（© PC2005-cloud，https://github.com/PC2005-cloud/dsh-pet），本项目仅重新装配为皮肤包'
const LICENSE = 'CC BY-NC-SA 4.0'
const ATTRIBUTION =
  '形象 © PC2005-cloud / dsh-pet（https://github.com/PC2005-cloud/dsh-pet），' +
  '授权 CC BY-NC-SA 4.0（署名 · 非商业 · 相同方式共享），禁止商用；' +
  '原型「溟月」出自 B 站 @上善无形，DeepSeek 版设计出自 B 站 @ZipZipPipe'

export type PackResult = { ok: true; json: string; manifest: SkinManifest } | { ok: false; errors: string[] }

/**
 * 把试穿皮肤（名字写着「不入库」）换成发布用的 manifest。
 *
 * 先校验再改字段：源皮肤本身不合法时，报错要指向源文件，
 * 而不是指向我们改完的那份——否则排查会追错地方。
 * `license` / `attribution` 是校验之后补的：皮肤契约不认这两个字段，但它们该随皮肤走。
 */
export function packManifest(raw: unknown): PackResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['manifest 不是一个对象'] }
  const checked = validateManifest({ ...(raw as Record<string, unknown>), name: NAME, author: AUTHOR })
  if (!checked.ok) return { ok: false, errors: checked.errors }

  const gaps = missingRequiredPools(checked.manifest)
  if (gaps.length) return { ok: false, errors: [`缺少必需动画池：${gaps.join('、')}`] }

  const out = { ...checked.manifest, license: LICENSE, attribution: ATTRIBUTION }
  return { ok: true, json: JSON.stringify(out, null, 2) + '\n', manifest: checked.manifest }
}

/**
 * 产品会按名点到的片段：日常/反应/跨级/说话档（ALL_CLIPS）+ 猜动作 20 条。
 *
 * 名单从 `animation.ts` 与 `guess.ts` 的表推导，绝不写死条数——改了表忘了改这里，
 * 出包闸门会拿旧名单放行。少了也不报错：装配层按名取不到就静默回落，
 * 表现是「启动/退出退化成 click」，正是评审点过的「把皮肤能力当合同」那个坑。
 */
function requiredProductClips(): string[] {
  const set = new Set<string>()
  for (const c of ALL_CLIPS) set.add(`${c.pool}/${c.name}`)
  for (const a of GUESS_ACTIONS) set.add(`${GUESS_POOL}/${a.name}`)
  return [...set].sort()
}

/** 池表里缺哪些产品片段，返回 `pool/name` 列表。 */
export function missingProductClips(pools: Record<string, string[]>): string[] {
  return requiredProductClips().filter((ref) => {
    const slash = ref.indexOf('/')
    const pool = ref.slice(0, slash)
    const name = ref.slice(slash + 1)
    return !(pools[pool] ?? []).includes(name)
  })
}

/**
 * manifest 写了名字，磁盘上还得真有这一段，返回缺的 `<pool>/<name><ext>` 列表。
 *
 * 为什么不并到 `missingProductClips` 里去：那一条查的是「皮肤能不能满足产品」，
 * 这一条查的是「装配目录是不是空的」——后者漏了会安静产出一个几百字节的 zip 并 exit 0，
 * 把上一个真包覆盖掉（实测踩过：拿只有 manifest、animation 为空的目录出包，照样「成功」）。
 * 存在性判断由调用方注入，shared 层不碰 fs。
 */
export function missingClipFiles(
  pools: Record<string, string[]>,
  hasFile: (pool: string, name: string) => boolean,
  ext: string = ANIMATION_EXT,
): string[] {
  const missing: string[] = []
  for (const [pool, names] of Object.entries(pools)) {
    for (const name of names) {
      if (!hasFile(pool, name)) missing.push(`${pool}/${name}${ext}`)
    }
  }
  return missing.sort()
}
