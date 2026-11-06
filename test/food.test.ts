import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FOODS, FOOD_LABEL_WIDTH, FOOD_TIERS } from '../src/shared/food.js'
import { labelWidth } from '../src/shared/text.js'
import { CLIP_NAME, POOL_NAME } from '../src/shared/skin.js'
import { EXP_PER_LEVEL, FOOD_EFFECT, levelOf, type FoodEffect } from '../src/shared/stats.js'

/**
 * 喂食列表的契约。
 *
 * 格子里现在放图，名字退成悬停 title 与读屏 label——名字仍要短，因为它是这两处唯一的说明。
 *
 * 动画名是**皮肤里的 clip 名（ascii slug）**，不是素材源里的中文文件名——
 * 皮肤契约的 CLIP_NAME 不接受汉字，中文原名记在切片脚本的映射表里。
 */

/** id → clip slug。对不上的那几条就是「我们叫它 A，素材叫它 B」的历史账，写出来才查得动。 */
const CLIP_OF: Record<string, string> = {
  token: 'token', rice: 'rice', tanghulu: 'tanghulu', crab: 'crab', hotpot: 'hotpot', dumpling: 'dumpling',
  // 面条走「吃午餐」、油条走「吃早餐」是用户 2026-11-06 拍的板（素材里没有吃面/吃油条那两条）
  noodle: 'lunch', youtiao: 'breakfast', melon: 'watermelon', snack: 'snack',
  niangao: 'ricecake', icecream: 'icecream',
}

describe('食物表', () => {
  it('十二条，id 唯一，按解锁档位排好（Lv.1 四样 → Lv.2 四样 → Lv.4 四样）', () => {
    expect(FOODS.map((f) => f.id)).toEqual([
      'token', 'rice', 'noodle', 'youtiao',
      'tanghulu', 'dumpling', 'melon', 'snack',
      'crab', 'hotpot', 'niangao', 'icecream',
    ])
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length)
    expect(FOOD_TIERS).toEqual([1, 2, 4])
    for (const tier of FOOD_TIERS) {
      expect(FOODS.filter((f) => f.level === tier), `Lv.${tier} 那档不是四样`).toHaveLength(4)
    }
    // 表必须**按档位有序**：面板一屏只放四格，顺序乱了用户就会看到「Lv.4 排在 Lv.1 前面」
    const levels = FOODS.map((f) => f.level)
    expect(levels.slice().sort((a, b) => a - b)).toEqual(levels)
  })

  it('每条都有图，且文件名就是 id——tools/make-food-icons.mjs 的映射表认这个形状', () => {
    for (const f of FOODS) {
      expect(f.icon, `${f.id} 没配图标`).toBe(`foods/${f.id}.png`)
    }
  })

  it('图标文件真的在仓库里：文件在仓库里不等于进得了 dist，但不在仓库里就一定 404', () => {
    for (const f of FOODS) {
      expect(existsSync(join('src/renderer', f.icon)), `${f.icon} 不在`).toBe(true)
    }
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

  it('动画名照 CLIP_OF 那张映射表，不再假设「slug 就是 id」', () => {
    // 前六条恰好同名，后六条不同名（面条→吃午餐、油条→吃早餐、年糕→吃年糕的 slug…）。
    // 上一版那条「anim.name === id」是同名的巧合，不是契约——它现在会把人骗过去。
    for (const f of FOODS) expect(f.anim!.name, `${f.id} 的 clip 名不对`).toBe(CLIP_OF[f.id])
  })

  it('每条都有数值效果，键就是 clip slug（主进程按 slug 查表，查不到就是「喂了不动」）', () => {
    for (const f of FOODS) {
      const e = FOOD_EFFECT[f.anim!.name]
      expect(e, `FOOD_EFFECT 里没有 ${f.anim!.name}（${f.name}）`).toBeDefined()
      expect(e!.hunger, `${f.name} 的顶饱值是负的`).toBeGreaterThan(0)
      expect(e!.weight, `${f.name} 的热量是负的`).toBeGreaterThan(0)
    }
  })

  it('档位越高越厚味（热量阶梯上升），但「顶饱」故意不单调——每档内部两个方向都要有', () => {
    /**
     * 这条钉的是设计意图，不是某个数。
     * 一开始我想钉「越高档越顶饱」，写完发现它是假的：Lv.1 的面条 16 就比 Lv.2 的西瓜 10 顶饱。
     * 真实的关系是**升级解锁的是「好吃但更容易长胖」的那一头**——零嘴档（糖葫芦、零食、冰淇淋）
     * 本来就不顶饱，这才是「喂零食要当心体重」这件事在游戏里有意义的理由。
     * 所以：热量按档位单调上升，顶饱不单调，但每一档内部都要同时有
     * 「顶饱但清淡」和「不顶饱但厚味」各一，否则选择退化成比大小，玩家只会点最高的那格。
     */
    const of = (tier: number): FoodEffect[] =>
      FOODS.filter((f) => f.level === tier).map((f) => FOOD_EFFECT[f.anim!.name]!)
    const avgW = (tier: number): number => of(tier).reduce((a, e) => a + e.weight, 0) / of(tier).length
    expect(avgW(2), `Lv.2 的平均热量没超过 Lv.1（${avgW(1)}）`).toBeGreaterThan(avgW(1))
    expect(avgW(4), `Lv.4 的平均热量没超过 Lv.2（${avgW(2)}）`).toBeGreaterThan(avgW(2))
    for (const tier of FOOD_TIERS) {
      const list = of(tier)
      expect(list.filter((e) => e.hunger >= 14).length, `Lv.${tier} 没有「顶饱但清淡」的代表`).toBeGreaterThan(0)
      expect(list.filter((e) => e.weight >= 1.2).length, `Lv.${tier} 没有「不顶饱但厚味」的代表`).toBeGreaterThan(0)
    }
    // 全场最顶饱的那一口，得在最高档里（解锁要有盼头）
    const best = FOODS.slice().sort((a, b) =>
      FOOD_EFFECT[b.anim!.name]!.hunger - FOOD_EFFECT[a.anim!.name]!.hunger)[0]!
    expect(best.level, `最顶饱的是 Lv.${best.level} 的${best.name}，不在最高档`).toBe(Math.max(...FOOD_TIERS))
  })

  it('最高档不是开局就能点：Lv.1 时它要够得着但够不到', () => {
    // 三档的门槛用经验说一遍，README 里那句「一天认真陪约三天一级」要对得上。
    expect(levelOf(0)).toBe(1)
    expect(levelOf(EXP_PER_LEVEL)).toBe(2)
    expect(levelOf(EXP_PER_LEVEL * 3)).toBe(4)
    const top = Math.max(...FOOD_TIERS)
    expect(levelOf(0), 'Lv.1 就能吃到最高档，解锁这条等于没有').toBeLessThan(top)
  })

  it('显示名放得进一格（现在用在 title/读屏，仍然别写成一句菜名）', () => {
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
