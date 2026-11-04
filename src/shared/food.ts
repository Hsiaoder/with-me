/**
 * 喂食列表的内容与它的排版契约。
 *
 * 从 config.ts 搬出来是因为这里要带一个函数（`labelWidth`），而 config 的规矩是
 * 「只有常量」。尺寸常量（格子边长、间距、一屏几格）仍留在 config。
 */

export type Food = {
  id: string
  /** 格子里显示的字。上限是**宽度**而不是字数——见 labelWidth。 */
  name: string
  /**
   * 吃这种东西播哪条动画。名字是皮肤里的 clip 名（ascii slug），
   * 素材源里的中文原名记在切片脚本的映射表里。
   * 没配、或皮肤里没有这个池，装配层回落到 click 池。
   */
  anim?: { pool: string; name: string }
}

/** 一格 56px、字号 13px，汉字约 13px 宽 → 上限按「几个汉字」算。 */
export const FOOD_LABEL_WIDTH = 4

/**
 * 估算显示宽度，单位是「一个汉字」。
 *
 * 为什么不直接数字符：`大闸蟹` 三个汉字比 `Token` 五个拉丁字母还宽，
 * 按码点数卡 4 会把 Token 挡在门外、却放过大闸蟹——量错了东西。
 */
export function labelWidth(text: string): number {
  let w = 0
  for (const ch of text) w += /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF60]/.test(ch) ? 1 : 0.55
  return w
}

export const FOODS: readonly Food[] = [
  { id: 'token', name: 'Token', anim: { pool: 'eat', name: 'token' } },
  { id: 'rice', name: '白饭', anim: { pool: 'eat', name: 'rice' } },
  { id: 'tanghulu', name: '糖葫芦', anim: { pool: 'eat', name: 'tanghulu' } },
  { id: 'crab', name: '大闸蟹', anim: { pool: 'eat', name: 'crab' } },
  // 素材源里没有「吃火锅」，只有「涮火锅」——格子上还是写火锅
  { id: 'hotpot', name: '火锅', anim: { pool: 'eat', name: 'hotpot' } },
  { id: 'dumpling', name: '饺子', anim: { pool: 'eat', name: 'dumpling' } },
]
