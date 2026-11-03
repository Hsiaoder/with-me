import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadFrom, saveTo } from '../src/main/storage.js'
import { defaultSave } from '../src/shared/save.js'
import { SAVE_FILE } from '../src/shared/config.js'

const NOW = 1_762_000_000_000
let dir = ''

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pet-save-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const main = (): string => join(dir, SAVE_FILE)
const bak = (): string => join(dir, `${SAVE_FILE}.bak`)

describe('saveTo', () => {
  it('写出合法 JSON，并刷新 lastSeenAt', () => {
    saveTo(dir, { ...defaultSave(NOW), skin: 'block' }, NOW + 5)
    const raw = JSON.parse(readFileSync(main(), 'utf8'))
    expect(raw.skin).toBe('block')
    expect(raw.lastSeenAt).toBe(NOW + 5)
  })

  it('warnings 不落盘', () => {
    saveTo(dir, { ...defaultSave(NOW), warnings: ['本次读档的诊断'] }, NOW)
    expect(JSON.parse(readFileSync(main(), 'utf8'))).not.toHaveProperty('warnings')
  })

  it('未来版本的档：读出来能跑，但一个字节都不写回', () => {
    // 新版本存的档被旧程序打开时，旧程序不认识字段。以前这里照样在退出时
    // 覆写主文件并生成 .bak，等于用一份降级档把用户的新档埋了。
    const future = { version: 99, skin: 'future', stats: { hunger: 1, mind: 2, clean: 3, mood: 4 }, lastSeenAt: NOW }
    writeFileSync(main(), JSON.stringify(future), 'utf8')
    const loaded = loadFrom(dir, NOW)
    expect(loaded.fromFuture).toBe(true)

    expect(saveTo(dir, loaded, NOW + 10_000)).toBe(false)
    expect(JSON.parse(readFileSync(main(), 'utf8'))).toEqual(future)
    expect(existsSync(bak())).toBe(false)
  })

  it('第二次写入留下上一版的 .bak', () => {
    saveTo(dir, { ...defaultSave(NOW), skin: 'a' }, NOW)
    saveTo(dir, { ...defaultSave(NOW), skin: 'b' }, NOW + 1)
    expect(JSON.parse(readFileSync(bak(), 'utf8')).skin).toBe('a')
    expect(JSON.parse(readFileSync(main(), 'utf8')).skin).toBe('b')
  })

  it('原子写：不留 .tmp 残渣', () => {
    saveTo(dir, defaultSave(NOW), NOW)
    expect(existsSync(join(dir, `${SAVE_FILE}.tmp`))).toBe(false)
  })

  it('目录不存在时自动创建', () => {
    const nested = join(dir, 'deep', 'deeper')
    saveTo(nested, defaultSave(NOW), NOW)
    expect(existsSync(join(nested, SAVE_FILE))).toBe(true)
  })
})

describe('loadFrom', () => {
  it('没有文件时返回默认值，且不创建文件', () => {
    const s = loadFrom(dir, NOW)
    expect(s.skin).toBe('block')
    expect(s.warnings).toEqual([])
    expect(existsSync(main())).toBe(false)
  })

  it('主文件损坏时回退到 .bak，并留一条警告', () => {
    saveTo(dir, { ...defaultSave(NOW), skin: 'good' }, NOW)
    saveTo(dir, { ...defaultSave(NOW), skin: 'newer' }, NOW + 1)
    writeFileSync(main(), '{ 坏掉的 json', 'utf8')
    const s = loadFrom(dir, NOW + 2)
    // .bak 里是**上一版**，也就是 good；newer 那次写入的内容随主文件一起丢了
    expect(s.skin).toBe('good')
    expect(s.warnings.join()).toContain('备份')
  })

  it('主文件与备份都坏时重置，仍然不抛异常', () => {
    saveTo(dir, { ...defaultSave(NOW), skin: 'x' }, NOW)
    saveTo(dir, { ...defaultSave(NOW), skin: 'y' }, NOW + 1)
    writeFileSync(main(), 'garbage', 'utf8')
    writeFileSync(bak(), 'also garbage', 'utf8')
    const s = loadFrom(dir, NOW + 2)
    expect(s.skin).toBe('block')
    expect(s.warnings.join()).toContain('已重置')
  })

  it('主文件是合法 JSON 但内容是垃圾时走迁移，而不是当损坏', () => {
    writeFileSync(main(), '"just a string"', 'utf8')
    const s = loadFrom(dir, NOW)
    expect(s.version).toBe(1)
    expect(s.skin).toBe('block')
  })

  it('写完立刻读回，字段一致', () => {
    saveTo(dir, { ...defaultSave(NOW), skin: 'block', stats: { hunger: 12, mind: 34, clean: 56, mood: 78 } }, NOW)
    const s = loadFrom(dir, NOW)
    expect(s.stats).toEqual({ hunger: 12, mind: 34, clean: 56, mood: 78 })
  })

  it('主文件是个目录时也不崩（existsSync 会放过它）', () => {
    mkdirSync(main())
    expect(() => loadFrom(dir, NOW)).not.toThrow()
    expect(loadFrom(dir, NOW).skin).toBe('block')
  })
})
