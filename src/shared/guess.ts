/**
 * 「猜动作」的纯逻辑（零 import，e2e 与单测直接 import）。
 *
 * 玩法：一局（一轮）固定 GUESS_QUESTIONS(=10) 道题，从库里抽 10 个**互不重复**的目标逐个问；每题宠物做一个动作，
 * 屏幕下浮出 3 个动作按钮，玩家点「它刚做的是哪个」。每题进度显示「正确:n/10」，答完最后一题显示这局总答对数。
 * 动作库 20 条（`GUESS_ACTIONS`），来自 dsh-pet 原片按**分类**分池——每类至少 3 条，
 * 这样任何一个目标都凑得出 2 个**同分类**的干扰项（用户 2026-11-08 要「每个正确项在同分类里挑另两个当错误答案」）。
 * 每轮 = 1 个真做的目标 + 2 个同分类干扰项，共 GUESS_OPTIONS 个按钮；目标一定在选项里。
 *
 * 不选「吃东西」类（那口是喂食列表的地盘，混进来会和吃相/食物表打架）。
 * pool 恒为 `guess`（皮肤里 `animation/guess/<name>.webm`）；name 是切片后的 ascii 名（见
 * spike/dsh-asar-extract.mjs），label 是按钮上的中文，category 只用来分组抽干扰项。
 */

export type GuessAction = { pool: string; name: string; label: string; category: string }

/** 每轮几个选项按钮（1 真 + 2 干扰）。 */
export const GUESS_OPTIONS = 3

/** 动作库所在的皮肤池名。 */
export const GUESS_POOL = 'guess'

/** 一条库动作：name=皮肤里的切片名，label=按钮中文，category=分组。 */
const g = (name: string, label: string, category: string): GuessAction => ({ pool: GUESS_POOL, name, label, category })

/**
 * 可猜的动作库（20 条，5 类，无「吃东西」）。★=用户点名的 12 个目标，其余 8 个是同分类里我挑的干扰项。
 * 分类分布：互动反应 4 / 特效与展示 4 / 舞蹈与音乐 5 / 节日与节气 4 / 玩耍 3——每类 ≥3，任意目标都有 ≥2 同类兄弟。
 */
export const GUESS_ACTIONS: readonly GuessAction[] = [
  // 互动反应
  g('tsundere', '傲娇生气', '互动反应'),
  g('shocked', '害羞惊讶', '互动反应'),
  g('cheerful', '开心跃动', '互动反应'),
  g('ticklish', '挠痒咯咯笑', '互动反应'),
  // 特效与展示
  g('dove', '变鸽子', '特效与展示'),
  g('whalebubbles', '鲸鱼吐泡泡', '特效与展示'),
  g('flowers', '凭空生花', '特效与展示'),
  g('bluewhale', '蓝鲸现世', '特效与展示'),
  // 舞蹈与音乐
  g('maid', '优雅女仆舞', '舞蹈与音乐'),
  g('flute', '吹笛子', '舞蹈与音乐'),
  g('violin', '小提琴演奏', '舞蹈与音乐'),
  g('swing', '轻快摇摆舞', '舞蹈与音乐'),
  g('otaku', '可爱宅舞', '舞蹈与音乐'),
  // 节日与节气
  g('liondance', '舞狮头', '节日与节气'),
  g('skylantern', '放孔明灯', '节日与节气'),
  g('fireworks', '放烟花', '节日与节气'),
  g('riverlamp', '放河灯', '节日与节气'),
  // 玩耍
  g('juggling', '三球抛接', '玩耍'),
  g('balloon', '吹气球', '玩耍'),
  g('spinningtop', '抽陀螺', '玩耍'),
]

export type Round = { target: GuessAction; options: GuessAction[] }

/** 一局（一轮）里出几道题：从库里抽这么多**互不重复**的目标，逐个问，答到最后一题结算总分。 */
export const GUESS_QUESTIONS = 10

/** 就地 Fisher-Yates 洗一遍（rng 注入；恰好返回 1 时夹到末位，绝不越界）。 */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)))
    const t = arr[i]!
    arr[i] = arr[j]!
    arr[j] = t
  }
  return arr
}

/**
 * 抽一局的题面目标序列：把整库洗一遍取前 count 个——洗牌 + 切片天然**不重复**，
 * 这样一整局里同一个动作不会被问两遍（用户 2026-11-08 要「一轮里不要出现重复动作」）。
 * count 不超过库大小；生产注入 Math.random，测试注入定值。
 */
export function pickTargets(rng: () => number, count: number = GUESS_QUESTIONS): GuessAction[] {
  const capped = Math.min(count, GUESS_ACTIONS.length)
  return shuffle([...GUESS_ACTIONS], rng).slice(0, capped)
}

/**
 * 给定目标，配一轮选项：1 个真目标 + GUESS_OPTIONS-1 个**同分类**的干扰项（目标自己不参选），
 * 再把「目标+干扰」洗一次顺序（别让正确答案总在第一颗）。每个分类都 ≥GUESS_OPTIONS 条，干扰项一定凑得齐。
 */
export function buildRound(target: GuessAction, rng: () => number): Round {
  const siblings = shuffle(GUESS_ACTIONS.filter((a) => a.category === target.category && a.name !== target.name), rng)
  const options = shuffle([target, ...siblings.slice(0, GUESS_OPTIONS - 1)], rng)
  return { target, options }
}
