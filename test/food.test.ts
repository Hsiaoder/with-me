import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FOODS, FOOD_LABEL_WIDTH, FOOD_TIERS, isUnlocked } from '../src/shared/food.js'
import { labelWidth } from '../src/shared/text.js'
import { CLIP_NAME, POOL_NAME } from '../src/shared/skin.js'
import { FOOD_EFFECT, LEVEL_CUM, levelOf } from '../src/shared/stats.js'

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
  dinner: 'dinner', tangyuan: 'tangyuan', qingtuan: 'qingtuan', labaporridge: 'labaporridge',
}

describe('食物表', () => {
  it('十六条，id 唯一，两档解锁：开局4 / 等级12（Lv.5 起每两级一格）', () => {
    expect(FOODS.map((f) => f.id)).toEqual([
      'token', 'rice', 'noodle', 'youtiao',
      'dinner', 'tanghulu', 'dumpling', 'melon', 'snack', 'niangao', 'tangyuan', 'qingtuan', 'labaporridge',
      'icecream', 'crab', 'hotpot',
    ])
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length)
    // 2026-11-07 用户再改：只放开前 4 格，其余按等级从 Lv.5 起每两级一格。期望从 unlock.kind 数，不抄清单。
    const kinds = FOODS.map((f) => f.unlock.kind)
    expect(kinds.filter((k) => k === 'start')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'level')).toHaveLength(12)
    for (const f of FOODS.filter((x) => x.unlock.kind === 'start')) {
      expect(isUnlocked(f, { level: 1 }), `${f.id} 开局就该能点`).toBe(true)
    }
    expect(FOOD_TIERS).toEqual([5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27])
    // 等级档从 Lv.5 起、每两级一格、有序
    const levels = FOODS.flatMap((f) => (f.unlock.kind === 'level' ? [f.unlock.level] : []))
    expect(levels[0], '第一格等级解锁该从 Lv.5 起').toBe(5)
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]! - levels[i - 1]!, `等级档第 ${i + 1} 格跳了级`).toBe(2)
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

  it('数值取向：开局清淡、越往后越顶饱，特殊口用心情补', () => {
    /**
     * 2026-11-07 数值重设计的意图（不是某个数）：
     * 前四格饱食低（5–10，别一上来喂顶）；等级段大体越往后越顶饱（解锁有盼头）；
     * 零食/冰淇淋是「特殊口」——饱食少但心情高；火锅双高。
     */
    const hunger = (id: string): number => FOOD_EFFECT[id]!.hunger
    const mood = (id: string): number => FOOD_EFFECT[id]!.mood
    for (const f of FOODS.filter((x) => x.unlock.kind === 'start')) {
      expect(hunger(f.id), `${f.name} 开局格该清淡`).toBeLessThanOrEqual(10)
    }
    const levelFoods = FOODS.filter((f) => f.unlock.kind === 'level')
    expect(hunger(levelFoods.at(-1)!.id), '最末格该比等级段第一格顶饱')
      .toBeGreaterThan(hunger(levelFoods[0]!.id))
    for (const id of ['snack', 'icecream']) {
      expect(hunger(id), `${id} 特殊口饱食该低`).toBeLessThan(8)
      expect(mood(id), `${id} 特殊口心情该高`).toBeGreaterThanOrEqual(15)
    }
    // 全场最顶饱的那一口在等级段靠后
    const best = FOODS.slice().sort((a, b) => hunger(b.id) - hunger(a.id))[0]!
    expect(FOODS.indexOf(best), `最顶饱的是${best.name}，不在等级段`).toBeGreaterThanOrEqual(FOODS.findIndex((f) => f.unlock.kind === 'level'))
  })

  it('最后一格开局点不到：Lv.1 够不着、Lv.60 够得着', () => {
    const last = FOODS[FOODS.length - 1]!
    expect(FOODS[0]!.unlock.kind, '第一格不该锁着').toBe('start')
    expect(isUnlocked(last, { level: 1 }), '开局就能吃最后一格，解锁这条等于没有').toBe(false)
    expect(isUnlocked(last, { level: 60 }), '满级还吃不到最后一格').toBe(true)
    const top = Math.max(...FOOD_TIERS)
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
