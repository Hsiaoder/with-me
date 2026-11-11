import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mimeOf } from '../src/main/protocol.js'

/**
 * 语音素材进 dist 的两道白名单（2026-11-11）：文件躺在仓库里不等于进得了 dist，
 * 复制白名单（copy-static）与 MIME 白名单（protocol）都得放行 mp3 和它的 json 清单。
 * 漏一道，fetch('voice/manifest.json') 或 Audio 取 mp3 就 404，宠物全程哑巴。
 */
const copyStatic = readFileSync('tools/copy-static.mjs', 'utf8')

describe('语音素材白名单', () => {
  it('copy-static 放行 mp3 与 json 清单', () => {
    const exts = copyStatic.match(/const STATIC_EXT = \[([^\]]*)\]/)?.[1] ?? ''
    expect(exts).toContain('.mp3')
    expect(exts).toContain('.json')
  })

  it('protocol 给 mp3 与 json 正确的 MIME', () => {
    expect(mimeOf('voice/line-001.mp3')).toBe('audio/mpeg')
    expect(mimeOf('voice/manifest.json')).toBe('application/json')
  })
})