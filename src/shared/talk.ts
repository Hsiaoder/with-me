/**
 * 宠物说什么、主人怎么回。纯逻辑，不碰 DOM、不碰时钟——时钟与随机都由调用方注入，
 * 所以「冷却」「概率」「组内选句」都能在单测里钉死。
 *
 * 台词放代码而不是皮肤 manifest：说话方式是产品人格，换皮不该换掉它。
 * 以后真要皮肤覆盖，在这里加一个可选的注入点就够了，v1 不做。
 *
 * 每句都配一条主人的短回复（照 qqpet 的 Line={tolk, submitText}）：气泡里那颗按钮
 * 就是这句回复，点下去气泡收掉。回复要放进 80px 宽的按钮，所以按宽度而不是字数卡。
 */

import { IDLE_LONG_MS, TALK_COOLDOWN_MS, TALK_IDLE_PROB, TALK_MAX_CHARS } from './config.js'
import { labelWidth } from './text.js'

export type TalkReason =
  | 'idle' | 'hungry' | 'blue'                 // 自己搭话（过「闲够 + 概率」那道门）
  | 'feed' | 'game' | 'status'                 // 事件驱动
  | 'levelup' | 'greet'                         // 低频高价值：走 pickLine（不看冷却）
  | 'puzzle' | 'unlock' | 'bye' | 'thanks'     // 新增；puzzle/unlock/bye 这版未接触发点

/** 自己搭话的几档：都要过「闲够了 + 概率」那道门。事件驱动的（喂/玩/拖）不受它管。 */
export const SELF_TALK_REASONS: readonly TalkReason[] = ['idle', 'hungry', 'blue']

/** 宠物说一句，按钮上是主人那句短回应。 */
export type Line = { say: string; reply: string }

export type TalkCtx = {
  /** 现在（同一时间基准由调用方给）。 */
  now: number
  /** 距上次交互过了多久。 */
  idleMs: number
  /** 上次开口是什么时候。 */
  lastTalkAt: number
}

/** 按钮宽 80px、字号 12px → 约 5 个汉字。留一点余量取 5。 */
export const REPLY_MAX_WIDTH = 5

export const TALK_LINES: Record<TalkReason, Line[]> = {
  // ---- 自己搭话（过闲够 + 概率那道门，三档共用）----
  idle: [
    { say: '无聊到数地板纹路了', reply: '别数我陪你' },
    { say: '你回来陪我玩嘛', reply: '来了来了' },
    { say: '一个人待着好安静', reply: '我在呢' },
    { say: '要不要一起干点啥', reply: '好啊' },
    { say: '我把这个屏幕看了三百遍', reply: '别看我了' },
    { say: '你在忙什么，能说说吗', reply: '一会儿就好' },
    { say: '数了一下，你两分钟没动', reply: '我在思考' },
    { say: '要不我们玩个游戏', reply: '玩什么' },
    { say: '我把自己待成了后台进程', reply: '辛苦你了' },
    { say: '这图标我盯半天了', reply: '别盯它' },
    { say: '有没有一种可能我想聊天', reply: '有' },
    { say: '你桌面真干净啊', reply: '刚整理过' },
    { say: '我刚刚好像打了个嗝', reply: '没事吧' },
    { say: '再闲下去我要长蘑菇了', reply: '马上陪你' },
    { say: '我在这，就是不知道干嘛', reply: '等着我' },
    { say: '你敲键盘的声音挺好听', reply: '真的吗' },
  ],
  hungry: [
    { say: '肚子叫了，有吃的吗', reply: '这就喂你' },
    { say: '好饿，趴一会儿', reply: '等着我去拿' },
    { say: '你闻闻，我饿了', reply: '拿你没办法' },
    { say: '我胃在跟你打招呼', reply: '马上开饭' },
    { say: '有鱼吗，随便什么鱼', reply: '挑一样' },
    { say: '饿到想啃自己的尾巴', reply: '别咬' },
    { say: '饭点在望，你看着办', reply: '这就来' },
    { say: '我数了一下，三小时没吃', reply: '忘了忘了' },
    { say: '给我一口就活过来了', reply: '张嘴' },
    { say: '闻着像有好吃的', reply: '是吗' },
  ],
  blue: [
    { say: '有点提不起劲', reply: '陪你歇会儿' },
    { say: '不太想动', reply: '那歇着吧' },
    { say: '你在吗，我闷', reply: '在呢在呢' },
    { say: '想被人摸一下头', reply: '摸摸' },
    { say: '今天不太想说话，但别关我', reply: '陪着你' },
    { say: '我蔫了，你能看出来吗', reply: '看得出来' },
    { say: '有点想你想得多一点', reply: '我也是' },
    { say: '没人理我的时候我在等', reply: '我来了' },
    { say: '需要一点小玩具', reply: '给你挑' },
    { say: '心情掉了一格', reply: '会好的' },
  ],
  // ---- 事件驱动（做了动作就该有反馈，不掷概率）----
  feed: [
    { say: '哇，是吃的！', reply: '吃吧吃吧' },
    { say: '这个我喜欢', reply: '多给点' },
    { say: '谢谢投喂', reply: '不客气' },
    { say: '肚子正咕咕叫呢', reply: '快吃吧' },
    { say: '让我尝尝这是什么', reply: '好吃的' },
    { say: '一口就认出来了', reply: '认得出？' },
    { say: '你居然知道我爱这个', reply: '我当然知道' },
    { say: '这个有点太饱了', reply: '那留着' },
    { say: '吃了，心情涨一格', reply: '值了' },
    { say: '我假装矜持一下再吃', reply: '别装了' },
  ],
  game: [
    { say: '玩什么？我准备好了', reply: '随便你挑' },
    { say: '来呀来呀', reply: '来' },
    { say: '我手气一向不错', reply: '那就试试' },
    { say: '规则你定，我负责赢', reply: '想得美' },
    { say: '这次不许反悔', reply: '我不反悔' },
    { say: '我先活动一下爪子', reply: '快点' },
    { say: '输了不许关我', reply: '我不会' },
    { say: '开始吧，我盯着呢', reply: '开始' },
  ],
  // 猜动作该说的话。这版没接上触发点：游戏态刻意不弹气泡（开局那句会撞上「开始后不弹气泡」那条 e2e 铁律）。
  puzzle: [
    { say: '看我这个动作，猜猜', reply: '在散步？' },
    { say: '猜错了我不承认', reply: '再猜' },
    { say: '我演得像不像', reply: '很像' },
    { say: '提示一下：跟吃有关', reply: '吃的' },
    { say: '这个我有十几种演法', reply: '换个演' },
    { say: '你猜对了我就转一圈', reply: '转吧' },
  ],
  status: [
    { say: '我精神好得很', reply: '那就好' },
    { say: '有点想睡觉', reply: '睡吧' },
    { say: '今天状态满分', reply: '真棒' },
    { say: '我活得挺规律的', reply: '继续保持' },
    { say: '身上有点不自在', reply: '去看看' },
    { say: '我把自己照顾得不错', reply: '放心了' },
  ],
  // 攒够经验跨级那一刻说一句（渲染层比的是前后两份快照的 Lv，不是「有没有喂」）。走 pickLine，不看冷却。
  levelup: [
    { say: '我感觉自己变强了', reply: '恭喜升级' },
    { say: '到新的一级了', reply: '继续加油' },
    { say: '我又长大了一点', reply: '真棒' },
    { say: '下一级我要更贪心', reply: '随你' },
    { say: '这些经验是我们的吧', reply: '是你的' },
    { say: '升级了，有礼物吗', reply: '想要什么' },
  ],
  // 解锁新食物/成就。这版没接上触发点：现有系统只在等级跨过时改食物列表可用性，没有「刚解锁」这一拍回调。
  unlock: [
    { say: '这个我还没吃过！', reply: '尝尝' },
    { say: '我解锁新东西了', reply: '历害' },
    { say: '你终于给我开这个了', reply: '早该开了' },
    { say: '新的！让我看看', reply: '喜欢吗' },
    { say: '攒了好久才到这个', reply: '值了' },
    { say: '我要把它排在第一个', reply: '排' },
  ],
  // 上线打招呼。启动一次已接线；真正的「每日首开」需要主进程给渲染层一个跨天信号，这版先按启动。
  greet: [
    { say: '你来啦，我等着呢', reply: '我来了' },
    { say: '今天也一起过', reply: '一起' },
    { say: '早上好，屏幕亮了', reply: '早' },
    { say: '你开机我就醒了', reply: '辛苦' },
    { say: '我又活在你桌面上了', reply: '欢迎回来' },
    { say: '今天打算忙什么', reply: '你猜' },
  ],
  // 退出说再见。这版没接上触发点：退出前气泡来不及显示（窗一关渲染层就没了），需要退出确认流程才谈得上。
  bye: [
    { say: '要关我了吗', reply: '明天见' },
    { say: '我睡一会儿，别删我', reply: '不删' },
    { say: '下次开机我还在这', reply: '好' },
    { say: '记得回来喂我', reply: '会记得' },
  ],
  // 点了气泡里的回应按钮之后（onReply 已接线）。
  thanks: [
    { say: '你回我了，开心', reply: '常回' },
    { say: '这句话我收好了', reply: '嗯' },
    { say: '你说话我就有劲', reply: '加油' },
    { say: '被你点到的感觉不错', reply: '那继续' },
  ],
  // 没有 drag / win / lose / expire / medicine：drag 是「拖拽时不弹气泡」的拍板（2026-11-05），
  // win/lose/expire/medicine 是台词表里标「这一版不加」的档。
}

/** 折叠换行、去首尾空白，超长按码点截断加省略号。空的一律变空串。 */
export function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  if (chars.length <= TALK_MAX_CHARS) return flat
  return chars.slice(0, TALK_MAX_CHARS).join('') + '…'
}

/**
 * 该不该开口、说什么。返回 null 就是这句不说。
 *
 * 概率只作用于「自己搭话」那几档（idle / hungry / blue）：用户做了动作（喂、点按钮）
 * 就该有回应，掷骰子决定「要不要理你」会把反馈丢掉。冷却对两者都生效，
 * 否则连点按钮会一句话接一句话刷屏。
 *
 * rng 的调用顺序是契约：自己搭话的先掷概率再抽句子，其余 reason 只抽句子。
 */
export function pickTalk(reason: TalkReason, ctx: TalkCtx, rng: () => number): Line | null {
  if (ctx.now - ctx.lastTalkAt < TALK_COOLDOWN_MS) return null
  if (SELF_TALK_REASONS.includes(reason)) {
    if (ctx.idleMs <= IDLE_LONG_MS) return null
    if (rng() >= TALK_IDLE_PROB) return null
  }
  const lines = TALK_LINES[reason]
  return lines[Math.floor(rng() * lines.length) % lines.length] ?? null
}

/**
 * 抽一句，**不看冷却**。
 *
 * 只给「跨级」用：喂食那一口正好把经验顶过门槛时，喂食的台词先说了（点击那一刻），
 * 快照随后才到（IPC 往返），于是 `pickTalk` 的 25 秒冷却会把跨级这句挡掉——
 * 而跨级是**几十口才一次**的事，比「这是吃的」重要得多，该盖掉前一句。
 * 气泡本来就是「覆盖而不是叠加」（同一时刻只许有一个），盖掉是它已有的行为，不需要新机制。
 */
export function pickLine(reason: TalkReason, rng: () => number): Line | null {
  const lines = TALK_LINES[reason]
  return lines[Math.floor(rng() * lines.length) % lines.length] ?? null
}

/** 回复放得下那颗按钮吗（装配层不需要问，测试与内容校准入用）。 */
export const replyFits = (line: Line): boolean => labelWidth(line.reply) <= REPLY_MAX_WIDTH

/**
 * 台词表摊平成一条有序流：面板「说话」按钮按顺序逐条放，走完绕回。
 * 顺序就是 `TALK_LINES` 里 reason 的书写顺序（idle → feed → game → status），
 * 再按各池里的行序——调试时要能预期「下一条是哪句」，所以这里刻意不用随机。
 */
export const TALK_FLOW: readonly Line[] = (Object.keys(TALK_LINES) as TalkReason[])
  .flatMap((r) => TALK_LINES[r])

/** 游标推进：-1 起步给第一条，走到末尾绕回 0。 */
export function nextTalkIndex(cur: number): number {
  return (cur + 1) % TALK_FLOW.length
}
