import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const copyStatic = readFileSync('tools/copy-static.mjs', 'utf8')

describe('界面字体接入（2026-11-07）', () => {
  it('两道白名单都放行 woff2 与 txt：漏一个字体就 404 落回雅黑', () => {
    const exts = copyStatic.match(/const STATIC_EXT = \[([^\]]*)\]/)?.[1] ?? ''
    expect(exts).toContain('.woff2')
    expect(exts).toContain('.txt')
  })

  it('@font-face 声明两支子集，思源走可变字重轴（一份覆盖 400/500）', () => {
    expect(css).toMatch(/@font-face \{[^}]*font-family: 'WithMe Sans';[^}]*url\('fonts\/with-me-sans-var\.woff2'\)[^}]*font-weight: 100 900/)
    expect(css).toMatch(/@font-face \{[^}]*font-family: 'WithMe Num';[^}]*url\('fonts\/with-me-num-400\.woff2'\)/)
  })

  it('默认与数字两条 token：思源在前雅黑兜底；数字栈 Fredoka 在前', () => {
    expect(css).toMatch(/--font-ui: 'WithMe Sans', 'Microsoft YaHei UI', sans-serif/)
    expect(css).toMatch(/--font-num: 'WithMe Num', 'WithMe Sans', 'Microsoft YaHei UI', sans-serif/)
    expect(css).toMatch(/html,\s*body \{[^}]*font-family: var\(--font-ui\)/)
  })

  it('不再有把雅黑当主字体的简写（兜底只留在 token 里）', () => {
    expect(css).not.toContain('"Microsoft YaHei UI", sans-serif')
  })

  it('加粗处映射到真 500，不留 600 合成加粗（12px 合成会发糊）', () => {
    expect(css).not.toMatch(/font-weight: 600/)
    expect(css).not.toMatch(/font: 600 /)
    expect(css).toMatch(/font-weight: 500/)
    expect(css).toMatch(/font: 500 12px\/1\.2 var\(--font-ui\)/)
  })

  it('子集与两份 OFL 真的在源里，且 woff2 魔数对（不是改后缀的空文件）', () => {
    for (const f of ['with-me-sans-var.woff2', 'with-me-num-400.woff2', 'OFL-noto-sans-sc.txt', 'OFL-fredoka.txt']) {
      expect(existsSync(`src/renderer/fonts/${f}`), `缺 src/renderer/fonts/${f}`).toBe(true)
    }
    for (const f of ['with-me-sans-var.woff2', 'with-me-num-400.woff2']) {
      expect(readFileSync(`src/renderer/fonts/${f}`).subarray(0, 4).toString('latin1')).toBe('wOF2')
    }
  })

  it('字体署名随包附 OFL 协议（不是 UI 里那行——设置板已去掉字体显示，出处靠随包 license 文件）', () => {
    for (const f of ['OFL-fredoka.txt', 'OFL-noto-sans-sc.txt']) {
      const text = readFileSync(`src/renderer/fonts/${f}`, 'utf8')
      expect(text).toMatch(/SIL OPEN FONT LICENSE/)
    }
  })

  /**
   * 随包的思源 OFL 正文是**上游自己发布的那一份**，逐字节一致。
   * 它的版权行写着 Adobe + Reserved Font Name 'Source'，看起来和「我们用 Noto 而非 Adobe 原版」矛盾——
   * 但 google/fonts 的 `ofl/notosanssc/OFL.txt` 就是这个开头（Noto Sans SC 与思源黑体同源，版权沿 Adobe 那条）。
   * RFN 约束管的是「改名后的 Modified Version 不许再用保留名」：子集已改名 with-me-sans-var，没踩。
   * 钉住字节数与首行，是为了防止有人「顺手改成 Google 的版权行」——那才是篡改上游许可正文。
   */
  it('随包的思源 OFL 是上游原文（改一个字都不行）', () => {
    const text = readFileSync('src/renderer/fonts/OFL-noto-sans-sc.txt', 'utf8').replace(/\r\n/g, '\n')
    expect(text.length).toBe(4388)
    expect(text.split('\n')[0]).toBe("Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'")
  })
})