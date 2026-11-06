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
}

/** 名字仍然要短：格子里现在放的是图，名字退到悬停 title 与读屏 label，两处都靠它说清「这是什么」。 */
export const FOOD_LABEL_WIDTH = 3

/**
 * 图标是 AI 生的（一张 3×2 总表），再由 `tools/make-food-icons.mjs` 逐块抠底、去水印、
 * 归一化成 128×128 透明 PNG。**没有第三方授权债**——这是选它而不是 iconfont / game-icons 的理由
 * （本项目要商用直播，NC/SA 素材一律不能用）。
 * 换图请改总表再跑脚本，别手改 PNG：脚本里那三步（洪水填充抠底 / 连通域分块 / 归一化）都是实测出来的坑。
 */
export const FOODS: readonly Food[] = [
  { id: 'token', name: '代币', icon: 'foods/token.png', anim: { pool: 'eat', name: 'token' } },
  { id: 'rice', name: '白饭', icon: 'foods/rice.png', anim: { pool: 'eat', name: 'rice' } },
  { id: 'tanghulu', name: '糖葫芦', icon: 'foods/tanghulu.png', anim: { pool: 'eat', name: 'tanghulu' } },
  { id: 'crab', name: '大闸蟹', icon: 'foods/crab.png', anim: { pool: 'eat', name: 'crab' } },
  // 素材源里没有「吃火锅」，只有「涮火锅」——格子上还是叫火锅
  { id: 'hotpot', name: '火锅', icon: 'foods/hotpot.png', anim: { pool: 'eat', name: 'hotpot' } },
  { id: 'dumpling', name: '饺子', icon: 'foods/dumpling.png', anim: { pool: 'eat', name: 'dumpling' } },
]
