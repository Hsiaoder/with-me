import { describe, it, expect } from 'vitest'
import {
  clipUrl,
  isLooping,
  isMirrorable,
  missingRequiredPools,
  validateManifest,
} from '../src/shared/skin.js'

/** 一份完全合法的 manifest，各条测试在它基础上做最小破坏。 */
const good = {
  formatVersion: 1,
  name: '色块',
  canvas: { w: 640, h: 360, feetY: 330 },
  bodyBox: { x: 200, y: 50, w: 240, h: 285 },
  pools: {
    idle: ['patrol', 'patrol2'],
    turn: ['left'],
    move: ['step'],
    click: ['tapped'],
    drag: ['pulled'],
  },
}

const errorsOf = (raw: unknown): string[] => {
  const r = validateManifest(raw)
  if (r.ok) throw new Error('本该拒绝，却通过了')
  return r.errors
}

describe('validateManifest', () => {
  it('合法 manifest 通过，且原样带出字段', () => {
    const r = validateManifest(good)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.manifest.pools.idle).toEqual(['patrol', 'patrol2'])
  })

  it('非对象输入直接拒绝，不抛异常', () => {
    for (const bad of [null, undefined, 42, 'x', []]) expect(validateManifest(bad).ok).toBe(false)
  })

  it('formatVersion 不认识就报错而不是猜', () => {
    expect(errorsOf({ ...good, formatVersion: 99 }).join()).toContain('formatVersion')
    expect(errorsOf({ ...good, formatVersion: '1' }).join()).toContain('formatVersion')
  })

  it('缺 bodyBox / name 时报出字段名', () => {
    const { bodyBox, ...noBox } = good
    expect(errorsOf(noBox).join()).toContain('bodyBox')
    const { name, ...noName } = good
    expect(errorsOf(noName).join()).toContain('name')
  })

  it('画布尺寸是锁死的，feetY 必须真的在画面内', () => {
    expect(errorsOf({ ...good, canvas: { w: 512, h: 512, feetY: 400 } }).join()).toContain('640x360')
    expect(errorsOf({ ...good, canvas: { w: 640, h: 360, feetY: 0 } }).join()).toContain('feetY')
    expect(errorsOf({ ...good, canvas: { w: 640, h: 360, feetY: 360 } }).join()).toContain('feetY')
  })

  it('bodyBox 越出画布要拒绝，否则命中框会跑到屏幕外', () => {
    expect(errorsOf({ ...good, bodyBox: { x: 500, y: 50, w: 240, h: 285 } }).join()).toContain('bodyBox')
    expect(errorsOf({ ...good, bodyBox: { x: 200, y: 100, w: 240, h: 285 } }).join()).toContain('bodyBox')
  })

  it('池必须是数组且非空', () => {
    expect(errorsOf({ ...good, pools: { ...good.pools, turn: 'left' } }).join()).toContain('turn')
    expect(errorsOf({ ...good, pools: { ...good.pools, move: [] } }).join()).toContain('move')
  })

  it('动画名要拼进文件路径和 URL，字符集从严', () => {
    for (const bad of ['../../etc/passwd', 'Jump Once', '_patrol', 'Patrol', '巡逻', 'a.b', '']) {
      const errs = errorsOf({ ...good, pools: { ...good.pools, idle: [bad] } })
      expect(errs.join(), `名字「${bad}」本该被拒`).toContain('idle')
    }
    // 合法形态：小写字母开头，数字/下划线/短横线
    expect(validateManifest({ ...good, pools: { ...good.pools, idle: ['patrol_v2-x'] } }).ok).toBe(true)
  })

  it('池名同样受限', () => {
    expect(errorsOf({ ...good, pools: { ...good.pools, '睡 觉': ['nap'] } }).join()).toContain('睡 觉')
  })

  it('animationMeta 指向不存在的动画时拒绝，说明 manifest 自己前后不一致', () => {
    const errs = errorsOf({ ...good, animationMeta: { jumped: { mirrorable: true } } })
    expect(errs.join()).toContain('jumped')
  })

  it('weights 只接受正数与已知池名', () => {
    expect(errorsOf({ ...good, weights: { idle: -1 } }).join()).toContain('weights')
    expect(errorsOf({ ...good, weights: { sleeping: 2 } }).join()).toContain('sleeping')
    expect(validateManifest({ ...good, weights: { idle: 5, move: 3 } }).ok).toBe(true)
  })
})

describe('必需池闸门', () => {
  it('结构合法但缺池时由 missingRequiredPools 列出', () => {
    const r = validateManifest({ ...good, pools: { idle: ['patrol'] } })
    expect(r.ok).toBe(true)
    expect(missingRequiredPools(r.ok ? r.manifest : (good as never))).toEqual(['turn', 'move', 'click', 'drag'])
  })
  it('池存在但被剔空也算缺', () => {
    const r = validateManifest({ ...good, pools: { ...good.pools, drag: ['pulled'] } })
    if (!r.ok) throw new Error(r.errors.join())
    expect(missingRequiredPools({ ...r.manifest, pools: { ...r.manifest.pools, drag: [] } })).toEqual(['drag'])
  })
})

describe('缺省规则（皮肤契约 3.1 / 3.2）', () => {
  const m = (over: Record<string, { loop?: boolean; mirrorable?: boolean }> = {}) => {
    const r = validateManifest({ ...good, animationMeta: over })
    if (!r.ok) throw new Error(r.errors.join())
    return r.manifest
  }

  it('状态性池缺省循环，反应性与自定义池缺省一次性', () => {
    expect(isLooping(m(), 'idle', 'patrol')).toBe(true)
    expect(isLooping(m(), 'turn', 'left')).toBe(true)
    expect(isLooping(m(), 'move', 'step')).toBe(true)
    expect(isLooping(m(), 'click', 'tapped')).toBe(false)
    expect(isLooping(m(), 'sleep', 'nap')).toBe(false)
  })

  it('作者显式写了 loop 就以作者为准', () => {
    expect(isLooping(m({ tapped: { loop: true } }), 'click', 'tapped')).toBe(true)
    expect(isLooping(m({ patrol: { loop: false } }), 'idle', 'patrol')).toBe(false)
  })

  it('mirrorable 缺省 false，不许擅自镜像角色的左右', () => {
    expect(isMirrorable(m(), 'patrol')).toBe(false)
    expect(isMirrorable(m({ patrol: { mirrorable: true } }), 'patrol')).toBe(true)
  })
})

describe('clipUrl', () => {
  it('地址固定为 app://skin/<池>/<名>.webm，与主进程注册的 skin 根对齐', () => {
    expect(clipUrl('idle', 'patrol')).toBe('app://skin/idle/patrol.webm')
  })
})
