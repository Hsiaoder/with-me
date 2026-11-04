import { describe, it, expect } from 'vitest'
import { FOODS, labelWidth, FOOD_LABEL_WIDTH } from '../src/shared/food.js'
import { CLIP_NAME, POOL_NAME } from '../src/shared/skin.js'

/**
 * 喂食列表的契约。格子是 56px 正方形、13px 字号，所以名字的限制本质是**宽度**，
 * 不是字符数：`大闸蟹` 三个汉字比 `Token` 五个拉丁字母还宽。
 *
 * 动画名是**皮肤里的 clip 名（ascii slug）**，不是素材源里的中文文件名——
 * 皮肤契约的 CLIP_NAME 不接受汉字，中文原名记在切片脚本的映射表里。
 */
describe('食物表', () => {
  it('六条，id 唯一', () => {
    expect(FOODS.map((f) => f.id)).toEqual(['token', 'rice', 'tanghulu', 'crab', 'hotpot', 'dumpling'])
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length)
  })

  it('每条都配了 eat 池的动画——这轮就是要让点食物播对应的吃', () => {
    for (const f of FOODS) {
      expect(f.anim, `${f.id} 没配 anim`).toBeDefined()
      expect(f.anim!.pool, `${f.id} 池名不对`).toBe('eat')
    }
  })

  it('池名与动画名都合法。eat 是扩展池，不在 REQUIRED_POOLS 里，所以只校验形状', () => {
    for (const f of FOODS) {
      expect(POOL_NAME.test(f.anim!.pool), `池名不合法：${f.anim!.pool}`).toBe(true)
      expect(CLIP_NAME.test(f.anim!.name), `动画名不合法：${f.anim!.name}`).toBe(true)
    }
  })

  it('动画名与 id 对齐，切片脚本的映射表才认得', () => {
    for (const f of FOODS) expect(f.anim!.name).toBe(f.id)
  })

  it('显示名放得进一格', () => {
    for (const f of FOODS) {
      expect(labelWidth(f.name), `${f.name} 太宽`).toBeLessThanOrEqual(FOOD_LABEL_WIDTH)
    }
  })
})

describe('labelWidth', () => {
  it('汉字按 1 算，拉丁按 0.55 算', () => {
    expect(labelWidth('大闸蟹')).toBeCloseTo(3, 6)
    expect(labelWidth('Token')).toBeCloseTo(2.75, 6)
  })

  it('全角标点也算一格（它和汉字一样占宽）', () => {
    expect(labelWidth('，')).toBeCloseTo(1, 6)
  })

  it('空串是 0', () => {
    expect(labelWidth('')).toBe(0)
  })

  it('混排两者相加', () => {
    expect(labelWidth('吃A')).toBeCloseTo(1.55, 6)
  })
})
