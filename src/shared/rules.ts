/**
 * 规则层：只决定「现在该进哪个池」，具体哪条动画交给随机层。
 *
 * 纯确定性：时间由注入的 `now` 提供，同样的事件序列必然得到同样的池名。
 * 「久无人理」不在事件里，由引擎自己按时钟算——同一个判断放两处迟早对不上。
 *
 * 久无人理之后返回 `AMBIENT_POOL` 而不是某个具体池名：挑 idle/move/turn 要靠皮肤
 * 的权重，那是随机层的活。规则层替它定了池，weights 就成了摆设。
 */

import { AMBIENT_POOL } from './config.js'

export type RuleEvent = 'interacted' | 'dragged' | 'tick'
export type RuleState = 'active' | 'respond' | 'drag'

export interface RuleEngine {
  readonly state: RuleState
  /** @returns 该播哪个池 */
  feed(ev: RuleEvent): string
}

export function createRuleEngine(now: () => number, idleLongMs: number): RuleEngine {
  let lastInteraction = now()
  let state: RuleState = 'active'

  return {
    get state() {
      return state
    },
    feed(ev) {
      switch (ev) {
        case 'interacted':
          lastInteraction = now()
          state = 'respond'
          return 'click'
        case 'dragged':
          lastInteraction = now()
          state = 'drag'
          return 'drag'
        case 'tick': {
          // 反应动画播完这一拍只归位，不顺便自主活动：刚互动完就跑开很怪
          if (state !== 'active') {
            state = 'active'
            return 'idle'
          }
          // 久无人理之后交出决策权。规则层不再钦定 move：那样皮肤的池权重永远用不上，
          // turn 永远不会自主出现，而且宠物会一路走到天荒地老。
          return now() - lastInteraction > idleLongMs ? AMBIENT_POOL : 'idle'
        }
      }
    },
  }
}
