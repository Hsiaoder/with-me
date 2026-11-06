import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FOODS, FOOD_LABEL_WIDTH, FOOD_TIERS, unlockLevelAt } from '../src/shared/food.js'
import { labelWidth } from '../src/shared/text.js'
import { CLIP_NAME, POOL_NAME } from '../src/shared/skin.js'
import { FOOD_EFFECT, LEVEL_CUM, levelOf, type FoodEffect } from '../src/shared/stats.js'

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
  it('十二条，id 唯一，解锁级由序号推（前 3 格 Lv.1，往后每两级放一格）', () => {
    expect(FOODS.map((f) => f.id)).toEqual([
      'token', 'rice', 'noodle', 'youtiao',
      'tanghulu', 'dumpling', 'melon', 'snack',
      'crab', 'hotpot', 'niangao', 'icecream',
    ])
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length)
    // 这条是 2026-11-07 用户改的规则：「一开始只能选前 3 个，后面每升两级解锁一个，直到全部解锁」。
    // 期望值不抄数字，直接从 unlockLevelAt 推——插一行菜时这里会跟着动，而不是变成一份过期的清单。
    expect(FOODS.map((f) => f.level)).toEqual(FOODS.map((_, i) => unlockLevelAt(i)))
    expect(FOODS.slice(0, 3).every((f) => f.level === 1), '前三个开局就该能点').toBe(true)
    expect(FOOD_TIERS).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19])
    // 表必须**按解锁级有序**：面板一屏只放四格，顺序乱了用户就会看到「Lv.17 排在 Lv.1 前面」
    const levels = FOODS.map((f) => f.level)
    expect(levels.slice().sort((a, b) => a - b)).toEqual(levels)
    // 每两级一格，所以相邻两档之间不许跳级
    for (let i = 4; i < levels.length; i++) {
      expect(levels[i]! - levels[i - 1]!, `第 ${i + 1} 格跳了 ${levels[i]! - levels[i - 1]!} 级`).toBe(2)
    }
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

  it('每条都有数值效果，键就是**食物 id**（面板报的是 id，查不到就是「喂了不动」）', () => {
    /**
     * 这张表以前按 clip slug 建键，而 `anim.name` 和 id 有四样不同名
     * （面条 lunch、油条 breakfast、西瓜 watermelon、年糕 ricecake）——
     * 那四格点下去吃相照播、账一步不走，而且没有任何地方报错。
     * 所以这里刻意读 `f.id` 而不是 `f.anim.name`：**两条通道各自的名字不能混用**。
     */
    for (const f of FOODS) {
      const e = FOOD_EFFECT[f.id]
      expect(e, `FOOD_EFFECT 里没有 ${f.id}（${f.name}）——这点下去饥饿体重都不会动`).toBeDefined()
      expect(e!.hunger, `${f.name} 的顶饱值是负的`).toBeGreaterThan(0)
      expect(e!.weight, `${f.name} 的热量是负的`).toBeGreaterThan(0)
    }
    // 反向对照：不同名的那四样，slug 键**不该**在表里（在的话说明两份真相又回来了）
    const renamed = FOODS.filter((f) => f.anim!.name !== f.id)
    expect(renamed.map((f) => f.id).sort(), '不该只有四样 id/slug 不同名').toEqual(['melon', 'niangao', 'noodle', 'youtiao'])
    for (const f of renamed) expect(FOOD_EFFECT[f.anim!.name], `${f.id} 的 slug ${f.anim!.name} 还在表里`).toBeUndefined()
  })

  it('越往后越厚味（热量阶梯上升），但「顶饱」故意不单调——每段内部两个方向都要有', () => {
    /**
     * 这条钉的是设计意图，不是某个数。
     * 一开始我想钉「越后面越顶饱」，写完发现它是假的：第 3 格的面条 16 就比第 7 格的西瓜 10 顶饱。
     * 真实的关系是**往后解锁的是「好吃但更容易长胖」的那一头**——零嘴那几格本来就不顶饱，
     * 这才是「喂零食要当心体重」这件事在游戏里有意义的理由。
     * 2026-11-07 解锁改成「每两级放一格」之后，档位不再是分组依据，所以这里按**序号三等分**：
     * 家常（0-3）/ 零嘴与主食（4-7）/ 硬菜稀罕口（8-11），正是表里那三段注释。
     * 每段内部都要同时有「顶饱但清淡」和「不顶饱但厚味」各一，否则选择退化成比大小，玩家只会点最高的那格。
     */
    const of = (from: number, to: number): FoodEffect[] =>
      FOODS.slice(from, to).map((f) => FOOD_EFFECT[f.id]!)
    const avgW = (from: number, to: number): number => {
      const list = of(from, to)
      return list.reduce((a, e) => a + e.weight, 0) / list.length
    }
    expect(avgW(4, 8), `中段平均热量没超过家常（${avgW(0, 4)}）`).toBeGreaterThan(avgW(0, 4))
    expect(avgW(8, 12), `硬菜段平均热量没超过中段（${avgW(4, 8)}）`).toBeGreaterThan(avgW(4, 8))
    for (const [from, to] of [[0, 4], [4, 8], [8, 12]] as const) {
      const list = of(from, to)
      expect(list.filter((e) => e.hunger >= 14).length, `第 ${from + 1}~${to} 格没有「顶饱但清淡」的代表`).toBeGreaterThan(0)
      expect(list.filter((e) => e.weight >= 1.2).length, `第 ${from + 1}~${to} 格没有「不顶饱但厚味」的代表`).toBeGreaterThan(0)
    }
    // 全场最顶饱的那一口，得在最后一组里（解锁要有盼头）
    const best = FOODS.slice().sort((a, b) =>
      FOOD_EFFECT[b.id]!.hunger - FOOD_EFFECT[a.id]!.hunger)[0]!
    expect(best.level, `最顶饱的是 Lv.${best.level} 的${best.name}，不在最后四格`).toBeGreaterThanOrEqual(FOODS[8]!.level)
  })

  it('最后一格不是开局就能点：Lv.1 时它要够得着但够不到', () => {
    // 门槛用经验说一遍，README 里那句「约第 8~9 天全解锁」要对得上这张表。
    const top = Math.max(...FOOD_TIERS)
    expect(FOODS[0]!.level, '第一格不该锁着').toBe(1)
    expect(levelOf(0), 'Lv.1 就能吃到最高那格，解锁这条等于没有').toBeLessThan(top)
    expect(levelOf(LEVEL_CUM[top - 1]!), `攒到 Lv.${top} 的经验查出来不是 ${top}`).toBe(top)
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
