/**
 * 喂食列表的内容。
 *
 * 从 config.ts 搬出来是因为 config 的规矩是「只放常量」，而这里带一条排版规则；
 * 尺寸常量（格子边长、间距、一屏几格）仍留在 config。
 * 宽度估算本身在 `shared/text.ts`——气泡按钮的回复上限用同一把尺，别两处各写一份。
 */

export type Food = {
  id: string
  /** 格子里显示的字。上限是**宽度**而不是字数——见 text.ts 的 labelWidth。 */
  name: string
  /**
   * 吃这种东西播哪条动画。名字是皮肤里的 clip 名（ascii slug），
   * 素材源里的中文原名记在切片脚本的映射表里。
   * 没配、或皮肤里没有这个池，装配层回落到 click 池。
   */
  anim?: { pool: string; name: string }
}

/** 一格 56px、字号 12px，汉字约 12px 宽 → 上限按「几个汉字」算。 */
export const FOOD_LABEL_WIDTH = 4

export const FOODS: readonly Food[] = [
  { id: 'token', name: '代币', anim: { pool: 'eat', name: 'token' } },
  { id: 'rice', name: '白饭', anim: { pool: 'eat', name: 'rice' } },
  { id: 'tanghulu', name: '糖葫芦', anim: { pool: 'eat', name: 'tanghulu' } },
  { id: 'crab', name: '大闸蟹', anim: { pool: 'eat', name: 'crab' } },
  // 素材源里没有「吃火锅」，只有「涮火锅」——格子上还是写火锅
  { id: 'hotpot', name: '火锅', anim: { pool: 'eat', name: 'hotpot' } },
  { id: 'dumpling', name: '饺子', anim: { pool: 'eat', name: 'dumpling' } },
]
