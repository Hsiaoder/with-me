/**
 * 屏幕上要显示的文字：标签宽度的估算与在线时长的格式。
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

/**
 * 把「陪了你多久」写成一句人话。
 *
 * 只留最大的两档：`3天2小时5分30秒` 在 150px 的卡上放不下，而且第 3 档往后
 * 就没有信息量了——「在线 2 小时 5 分」和「2 小时 5 分 30 秒」对用户是同一件事。
 * 秒只在分钟还没到 1 的时候露出来，那正是用户刚启动、要看「它活着没有」的时候。
 */
export function formatOnline(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) return `${d}天${h}小时`
  if (h > 0) return `${h}小时${m}分`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}
