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
   * 几级开始能吃（**含本级**）。2026-11-07 用户改口：「一开始只能选前 3 个，之后每升两级解锁一个，
   * 直到全部解锁」——原来是三档 Lv.1/2/4 每档四样，那是一口气放四样，读起来像「换了一批菜单」
   * 而不是「又尝到一样新东西」。
   * 这个数**不写在表里**，由序号推（见 `unlockLevelAt`）：手抄 12 个数字的话，插一行菜就得重排一遍，
   * 而漏改的那一格会安静地永远锁着。
   */
  level: number
}

/**
 * 第 i 格（从 0 数）几级解锁：前 3 格 Lv.1 就有，往后每升 2 级多放一格 → `max(1, 2i − 3)`。
 * 第 4 格 Lv.3、第 5 格 Lv.5……第 12 格 Lv.19（按现在的速率约第 8~9 天）。
 * 用 `max` 兜住前 3 格而不是分两种写法：判据仍是同一条 `level >= f.level`。
 */
export const unlockLevelAt = (i: number): number => Math.max(1, 2 * i - 3)

/** 名字仍然要短：格子里现在放的是图，名字退到悬停 title 与读屏 label，两处都靠它说清「这是什么」。 */
export const FOOD_LABEL_WIDTH = 3

/**
 * 这张表的排法就是解锁顺序（见上面 `unlockLevelAt`），分组读起来是「先家常、再零嘴、最后硬菜」：
 * · 前四格家常口粮——随时能上手的一碗：代币、白饭、面条、油条（Lv.1 就都能点）；
 * · 中间四格街边零嘴与要动手的主食：糖葫芦 Lv.3、饺子 Lv.5、西瓜 Lv.7、零食 Lv.9；
 * · 后四格硬菜和稀罕口：大闸蟹 Lv.11、火锅 Lv.13、年糕 Lv.15、冰淇淋 Lv.17。
 *   年糕排在倒数第二是顺手借「年年高」那句寓意：它开的时候正卡在升级那条路上。
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
/** 表里还没算解锁级的那一份。`level` 由序号推，所以它不该出现在手写清单里。 */
type FoodSeed = Omit<Food, 'level'>

const RAW_FOODS: readonly FoodSeed[] = [
  // ---- 家常口粮：Lv.1 就有 ----
  { id: 'token', name: '代币', icon: 'foods/token.png', anim: { pool: 'eat', name: 'token' } },
  { id: 'rice', name: '白饭', icon: 'foods/rice.png', anim: { pool: 'eat', name: 'rice' } },
  { id: 'noodle', name: '面条', icon: 'foods/noodle.png', anim: { pool: 'eat', name: 'lunch' } },
  { id: 'youtiao', name: '油条', icon: 'foods/youtiao.png', anim: { pool: 'eat', name: 'breakfast' } },
  // ---- 街边零嘴与要动手的主食：Lv.3 / 5 / 7 / 9 ----
  { id: 'tanghulu', name: '糖葫芦', icon: 'foods/tanghulu.png', anim: { pool: 'eat', name: 'tanghulu' } },
  { id: 'dumpling', name: '饺子', icon: 'foods/dumpling.png', anim: { pool: 'eat', name: 'dumpling' } },
  { id: 'melon', name: '西瓜', icon: 'foods/melon.png', anim: { pool: 'eat', name: 'watermelon' } },
  { id: 'snack', name: '零食', icon: 'foods/snack.png', anim: { pool: 'eat', name: 'snack' } },
  // ---- 硬菜与稀罕口：Lv.11 / 13 / 15 / 17 ----
  { id: 'crab', name: '大闸蟹', icon: 'foods/crab.png', anim: { pool: 'eat', name: 'crab' } },
  { id: 'hotpot', name: '火锅', icon: 'foods/hotpot.png', anim: { pool: 'eat', name: 'hotpot' } },
  // 年糕排最后第二格是顺手借「年年高」那句寓意：它 Lv.15 开，正卡在升级那条路上。
  { id: 'niangao', name: '年糕', icon: 'foods/niangao.png', anim: { pool: 'eat', name: 'ricecake' } },
  { id: 'icecream', name: '冰淇淋', icon: 'foods/icecream.png', anim: { pool: 'eat', name: 'icecream' } },
]

/**
 * 顺序**就是**解锁顺序（`unlockLevelAt(序号)`），所以这张表的排法是有意义的：
 * 前面是随时能上手的一碗，中间是街边零嘴与要动手的主食，最后是硬菜和稀罕口。
 * 插一行菜会自动往后挤一格，不用重排任何数字——这正是把 level 从表里拿掉的理由。
 */
export const FOODS: readonly Food[] = RAW_FOODS.map((f, i) => ({ ...f, level: unlockLevelAt(i) }))

/** 有哪几档解锁级别（面板写角标、测试数档位都从这里读，不再各自抄一份清单）。 */
export const FOOD_TIERS: readonly number[] = [...new Set(FOODS.map((f) => f.level))].sort((a, b) => a - b)
