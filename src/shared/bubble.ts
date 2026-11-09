/**
 * 「点破泡泡」的纯逻辑（零 import，e2e 与单测直接 import）。
 *
 * 玩法：限时内泡泡从底部不断冒出往上飘，点中一个就破、计数 +1，时间到按破掉数结算。
 * 泡泡用 SVG 画（**正圆** + 高光，只变颜色与大小），不用图片素材；这里只管「一个泡泡长什么样、飘多快」，
 * 摆 DOM、计时、点击判定在渲染层 `renderer/bubble-game.ts`。
 */

/** 一局多少秒。 */
export const BUBBLE_GAME_SECONDS = 30
/** 每隔多久冒一个新泡泡（毫秒）。 */
export const BUBBLE_SPAWN_MS = 620
/** 泡泡直径范围（CSS px）。 */
export const BUBBLE_MIN_SIZE = 36
export const BUBBLE_MAX_SIZE = 84
/** 柔和色相池（HSL 的 H）：蓝/青/紫/粉/橙/绿，半透明填充出来都清淡。 */
export const BUBBLE_HUES: readonly number[] = [200, 175, 262, 322, 38, 132]
/** 前这几秒匀速（让用户先上手），之后越来越快（用户 2026-11-08 要的难度曲线）。 */
export const BUBBLE_CALM_SECONDS = 3
/** 过了匀速期后，每多 1 秒速度增加的比例（0.1 = 每秒 +10%；30s 时约 3.7 倍）。 */
export const BUBBLE_RAMP_RATE = 0.1
/** 横向车道数：泡泡轮转落在各条里，左右铺得匀（纯随机会挤到一侧）。 */
export const BUBBLE_LANES = 5

/** 上浮速度的时间倍率：前 BUBBLE_CALM_SECONDS 秒恒为 1，之后线性爬升。作用于场上所有泡泡。 */
export function bubbleSpeedFactor(elapsedSec: number): number {
  if (elapsedSec <= BUBBLE_CALM_SECONDS) return 1
  return 1 + (elapsedSec - BUBBLE_CALM_SECONDS) * BUBBLE_RAMP_RATE
}

export type Bubble = {
  /** 左沿 x（CSS px，整个泡泡落在 [0, viewportW] 内）。 */
  x: number
  /** 直径（px）。泡泡都是正圆，大小不同。 */
  size: number
  /** 色相（HSL H）。 */
  hue: number
  /** 上浮速度（px/s）。 */
  speed: number
  /** 左右晃动的相位（弧度），让每个泡泡晃得不一样。 */
  wobble: number
}

/** 抽一个泡泡：尺寸/色相/速度由 rng 定（e2e/单测注入定值，生产 Math.random）。形状恒为正圆。
 *  横向按**车道**落点：把屏宽分成 lanes 条，第 lane 条里随机取 x。控制器轮转 lane（0,1,2,…），
 *  泡泡就左右铺得匀，不会纯随机挤到一侧（用户 2026-11-08 要「左右均匀」）。lanes=1 退化为全宽随机。 */
export function makeBubble(rng: () => number, viewportW: number, lane = 0, lanes = BUBBLE_LANES): Bubble {
  const size = BUBBLE_MIN_SIZE + rng() * (BUBBLE_MAX_SIZE - BUBBLE_MIN_SIZE)
  const laneW = viewportW / Math.max(1, lanes)
  const inLane = lane * laneW + rng() * Math.max(0, laneW - size)
  const x = Math.min(Math.max(0, inLane), Math.max(0, viewportW - size))
  const hue = BUBBLE_HUES[Math.floor(rng() * BUBBLE_HUES.length)]!
  const speed = 60 + rng() * 90
  const wobble = rng() * Math.PI * 2
  return { x, size, hue, speed, wobble }
}
