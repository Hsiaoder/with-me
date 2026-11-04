/**
 * 文字宽度的估算。
 *
 * 为什么不用「字符数」：`大闸蟹` 三个汉字比 `Token` 五个拉丁字母还宽。
 * 按码点数卡上限会挡掉 Token 却放过大闸蟹——量错了东西。
 * 这里没有排版引擎，只能估：汉字/假名/全角标点记 1，其余记 0.55。
 */

/**
 * 范围写成转义而不是字面量：字面量在编辑器里看不出边界在哪，
 * 而且上面那版直接被写成了裸字符，末尾的 `-` 看着像笔误其实是个字面连字符。
 */
const WIDE = new RegExp(
  '[\\u3000-\\u303F\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFF60]',
)

export function labelWidth(text: string): number {
  let w = 0
  for (const ch of text) w += WIDE.test(ch) ? 1 : 0.55
  return w
}

/** 放得下就返回 true。max 的单位是「几个汉字宽」。 */
export function fitsLabel(text: string, max: number): boolean {
  return labelWidth(text) <= max
}
