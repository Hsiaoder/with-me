/**
 * 小游戏清单。和 `shared/food.ts` 同一个道理：能玩什么是一张数据表，面板只管照着列，
 * 装配层按 `id` 决定开哪个游戏。现在只有「鲸鲸会飞」真正做好了，加游戏往这里追加一行即可。
 * 列表的 UI 和食物列表一致：一格一个方卡，格子里是图标，名字退成 title / aria-label。
 */
export type GameId = 'fly' | 'guess' | 'bubble'

export type Game = {
  id: GameId
  /** 列表里那格的名字（读屏与悬停用）。 */
  name: string
  /** 格子里的图标，走 app:// 同源，和食物格子同一套。 */
  icon: string
  /** 一句话玩法，悬停卡片里显示。 */
  desc: string
}

export const GAMES: readonly Game[] = [
  { id: 'fly', name: '鲸鲸会飞', icon: 'icons/game-fly.png', desc: '抓住宠物往上抛，看它飞多高。' },
  { id: 'guess', name: '猜动作', icon: 'icons/game-guess.png', desc: '看宠物做动作，猜它做的是哪一个。' },
  { id: 'bubble', name: '点泡泡', icon: 'icons/game-bubble.png', desc: '限时点破飘上来的泡泡，破得越多分越高。' },
]
