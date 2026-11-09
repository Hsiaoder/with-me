/**
 * 喂食列表的内容。
 *
 * 从 config.ts 搬出来是因为 config 的规矩是「只放常量」，而这里带一条排版规则；
 * 尺寸常量（格子边长、间距、一屏几格）仍留在 config。
 * 宽度估算本身在 `shared/text.ts`——气泡按钮的回复上限用同一把尺，别两处各写一份。
 */

export type Food = {
  id: string
  /** 悬停 title 与读屏念的名字。上限是**宽度**而不是字数——见 text.ts 的 labelWidth。 */
  name: string
  /**
   * 格子里的图。图是主角、名字退成 title/aria-label（和面板那五颗按钮同一套约定），
   * 所以 name 仍然要短——它现在只出现在悬停提示里。
   * 路径相对 renderer 根，由 `tools/make-food-icons.mjs` 从 AI 总表切出来，别手改。
   */
  icon: string
  /**
   * 吃这种东西播哪条动画。名字是皮肤里的 clip 名（ascii slug），
   * 素材源里的中文原名记在切片脚本的映射表里。
   * 没配、或皮肤里没有这个池，装配层回落到 click 池。
   */
  anim?: { pool: string; name: string }
  /** 几时能吃：开局 / 到等级 / 亲密到阈值（成就）。见下面三档的排法说明。 */
  unlock: Unlock
}

/**
 * 解锁两档（2026-11-07 用户再改：只放开前 4 格，其余按等级从 Lv.5 起每两级放一格）：
 * · `start` 开局就能点——前四格家常口粮；
 * · `level` 到 Lv.N 解锁——其余十二格，Lv.5 / 7 / 9 … 一路到 Lv.27。
 * 亲密成就档撤了：用户不要「靠陪伴解锁」这一层。
 */
export type Unlock =
  | { kind: 'start' }
  | { kind: 'level'; level: number }

export type UnlockCtx = { level: number }

/** 唯一判据：面板灰态、测试、e2e 都走它，别各自再写一份比较。 */
export function isUnlocked(f: Food, ctx: UnlockCtx): boolean {
  return f.unlock.kind === 'start' || ctx.level >= f.unlock.level
}

/** 锁住时格子上那枚角标；开局格返回空串（不画角标）。 */
export function unlockBadge(f: Food): string {
  return f.unlock.kind === 'level' ? `Lv.${f.unlock.level}` : ''
}

/** 悬停 / 读屏的整句说明：锁住的那格必须连「为什么点不动」一起说清。 */
export function unlockHint(f: Food): string {
  return f.unlock.kind === 'level' ? `${f.name}（Lv.${f.unlock.level} 解锁）` : f.name
}

/** 名字仍然要短：格子里现在放的是图，名字退到悬停 title 与读屏 label，两处都靠它说清「这是什么」。 */
export const FOOD_LABEL_WIDTH = 3

/**
 * 排法 = 展示顺序 = 解锁顺序（2026-11-07 用户再改）：
 * · 前四格开局就有：代币、白饭、面条、油条；
 * · 其余十二格按等级，从 Lv.5 起每两级放一格：
 *   晚餐5 / 糖葫芦7 / 饺子9 / 西瓜11 / 零食13 / 年糕15 / 汤圆17 / 青团19 / 腊八粥21 / 冰淇淋23 / 大闸蟹25 / 火锅27。
 *   晚餐从「开局」挪进等级档是这条规则的必然结果——只放开前 4 格，第 5 格开始就要升级。
 *
 * 图标是 AI 生的（三张总表：前两张 3×2、第三张 2×2），再由 `tools/make-food-icons.mjs`
 * 逐块抠底、去水印、归一化成 128×128 透明 PNG。**没有第三方授权债**——这是选它而不是
 * iconfont / game-icons 的理由（本项目要商用直播，NC/SA 素材一律不能用）。
 * 换图请改总表再跑脚本，别手改 PNG；个别生图底偏灰时给脚本第六参调低底阈值。
 *
 * 动画 slug 与素材源原名（源在 asar，只进临时试穿包、不进仓库）：noodle←吃午餐、youtiao←吃早餐、
 * melon←吃西瓜、snack←大口吃零食、icecream←吃冰淇淋融化、niangao←吃年糕、
 * dinner←吃晚餐、tangyuan←吃汤圆、qingtuan←吃青团、labaporridge←吃腊八粥。
 * **面条走「吃午餐」、油条走「吃早餐」**是用户拍的板：素材里没有吃面/吃油条那两条。
 */
const RAW_FOODS: readonly Food[] = [
  // ---- 开局：前四格家常口粮 ----
  { id: 'token', name: '代币', icon: 'foods/token.png', anim: { pool: 'eat', name: 'token' }, unlock: { kind: 'start' } },
  { id: 'rice', name: '白饭', icon: 'foods/rice.png', anim: { pool: 'eat', name: 'rice' }, unlock: { kind: 'start' } },
  { id: 'noodle', name: '面条', icon: 'foods/noodle.png', anim: { pool: 'eat', name: 'lunch' }, unlock: { kind: 'start' } },
  { id: 'youtiao', name: '油条', icon: 'foods/youtiao.png', anim: { pool: 'eat', name: 'breakfast' }, unlock: { kind: 'start' } },
  // ---- 等级：从 Lv.5 起每两级一格，一路到 Lv.27 ----
  { id: 'dinner', name: '晚餐', icon: 'foods/dinner.png', anim: { pool: 'eat', name: 'dinner' }, unlock: { kind: 'level', level: 5 } },
  { id: 'tanghulu', name: '糖葫芦', icon: 'foods/tanghulu.png', anim: { pool: 'eat', name: 'tanghulu' }, unlock: { kind: 'level', level: 7 } },
  { id: 'dumpling', name: '饺子', icon: 'foods/dumpling.png', anim: { pool: 'eat', name: 'dumpling' }, unlock: { kind: 'level', level: 9 } },
  { id: 'melon', name: '西瓜', icon: 'foods/melon.png', anim: { pool: 'eat', name: 'watermelon' }, unlock: { kind: 'level', level: 11 } },
  { id: 'snack', name: '零食', icon: 'foods/snack.png', anim: { pool: 'eat', name: 'snack' }, unlock: { kind: 'level', level: 13 } },
  { id: 'niangao', name: '年糕', icon: 'foods/niangao.png', anim: { pool: 'eat', name: 'ricecake' }, unlock: { kind: 'level', level: 15 } },
  { id: 'tangyuan', name: '汤圆', icon: 'foods/tangyuan.png', anim: { pool: 'eat', name: 'tangyuan' }, unlock: { kind: 'level', level: 17 } },
  { id: 'qingtuan', name: '青团', icon: 'foods/qingtuan.png', anim: { pool: 'eat', name: 'qingtuan' }, unlock: { kind: 'level', level: 19 } },
  { id: 'labaporridge', name: '腊八粥', icon: 'foods/labaporridge.png', anim: { pool: 'eat', name: 'labaporridge' }, unlock: { kind: 'level', level: 21 } },
  { id: 'icecream', name: '冰淇淋', icon: 'foods/icecream.png', anim: { pool: 'eat', name: 'icecream' }, unlock: { kind: 'level', level: 23 } },
  { id: 'crab', name: '大闸蟹', icon: 'foods/crab.png', anim: { pool: 'eat', name: 'crab' }, unlock: { kind: 'level', level: 25 } },
  { id: 'hotpot', name: '火锅', icon: 'foods/hotpot.png', anim: { pool: 'eat', name: 'hotpot' }, unlock: { kind: 'level', level: 27 } },
]

export const FOODS: readonly Food[] = RAW_FOODS

/** 有哪几档**等级**解锁（面板/测试数等级档从这里读）。成就档不混进来：它不吃等级。 */
export const FOOD_TIERS: readonly number[] = [...new Set(
  FOODS.flatMap((f) => (f.unlock.kind === 'level' ? [f.unlock.level] : [])),
)].sort((a, b) => a - b)
