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
  /**
   * 几级开始能吃（**含本级**）。用户 2026-11-06 要「等级低只能吃简单的，高了解锁更多」，
   * 拍的节奏是三档 Lv.1 / Lv.2 / Lv.4，每档四样。
   * 这里存数字而不是「解锁条件对象」：判据就一条 `level >= f.level`，
   * 以后真要加「今天已经喂过」那种条件再抽象不迟。
   */
  level: number
}

/** 名字仍然要短：格子里现在放的是图，名字退到悬停 title 与读屏 label，两处都靠它说清「这是什么」。 */
export const FOOD_LABEL_WIDTH = 3

/**
 * 三档是怎么分的（不是按价格，是按**做法与时令**）：
 * · Lv.1 家常口粮——随时能上手的一碗：代币、白饭、面条、油条；
 * · Lv.2 有滋味——街边零嘴与要动手的主食：糖葫芦、饺子、西瓜、零食；
 * · Lv.4 讲究——硬菜和稀罕口：大闸蟹、火锅、年糕、冰淇淋。
 *   年糕放最高档是顺手借「年年高」那句寓意：升级那天正好吃得着。
 *
 * 图标是 AI 生的（两张 3×2 总表），再由 `tools/make-food-icons.mjs` 逐块抠底、去水印、
 * 归一化成 128×128 透明 PNG。**没有第三方授权债**——这是选它而不是 iconfont / game-icons 的理由
 * （本项目要商用直播，NC/SA 素材一律不能用）。
 * 换图请改总表再跑脚本，别手改 PNG：脚本里那三步（洪水填充抠底 / 连通域分块 / 归一化）都是实测出来的坑。
 *
 * 动画 slug 与素材源原名（源在 `E:/localwork/pet-animations/animations/random/`，
 * 只进临时试穿包、不进仓库）：noodle←吃午餐、youtiao←吃早餐、melon←吃西瓜、
 * snack←大口吃零食、icecream←吃冰淇淋融化、niangao←吃年糕。
 * **面条走「吃午餐」、油条走「吃早餐」**是用户拍的板：素材里没有吃面/吃油条那两条，
 * 而这两条的姿势对得上「捧着一碗/一根咬着吃」，格子上仍写我们自己的名字。
 */
export const FOODS: readonly Food[] = [
  // ---- Lv.1 家常 ----
  { id: 'token', name: '代币', icon: 'foods/token.png', anim: { pool: 'eat', name: 'token' }, level: 1 },
  { id: 'rice', name: '白饭', icon: 'foods/rice.png', anim: { pool: 'eat', name: 'rice' }, level: 1 },
  { id: 'noodle', name: '面条', icon: 'foods/noodle.png', anim: { pool: 'eat', name: 'lunch' }, level: 1 },
  { id: 'youtiao', name: '油条', icon: 'foods/youtiao.png', anim: { pool: 'eat', name: 'breakfast' }, level: 1 },
  // ---- Lv.2 有滋味 ----
  { id: 'tanghulu', name: '糖葫芦', icon: 'foods/tanghulu.png', anim: { pool: 'eat', name: 'tanghulu' }, level: 2 },
  { id: 'dumpling', name: '饺子', icon: 'foods/dumpling.png', anim: { pool: 'eat', name: 'dumpling' }, level: 2 },
  { id: 'melon', name: '西瓜', icon: 'foods/melon.png', anim: { pool: 'eat', name: 'watermelon' }, level: 2 },
  { id: 'snack', name: '零食', icon: 'foods/snack.png', anim: { pool: 'eat', name: 'snack' }, level: 2 },
  // ---- Lv.4 讲究 ----
  { id: 'crab', name: '大闸蟹', icon: 'foods/crab.png', anim: { pool: 'eat', name: 'crab' }, level: 4 },
  { id: 'hotpot', name: '火锅', icon: 'foods/hotpot.png', anim: { pool: 'eat', name: 'hotpot' }, level: 4 },
  { id: 'niangao', name: '年糕', icon: 'foods/niangao.png', anim: { pool: 'eat', name: 'ricecake' }, level: 4 },
  { id: 'icecream', name: '冰淇淋', icon: 'foods/icecream.png', anim: { pool: 'eat', name: 'icecream' }, level: 4 },
]

/** 有哪几档（面板写角标、测试数档位都从这里读，不再各自抄一份清单）。 */
export const FOOD_TIERS: readonly number[] = [...new Set(FOODS.map((f) => f.level))].sort((a, b) => a - b)
