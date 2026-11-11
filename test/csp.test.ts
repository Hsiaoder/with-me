import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('src/renderer/index.html', 'utf8')

describe('renderer CSP', () => {
  it('页面声明了 Content-Security-Policy', () => {
    expect(html).toMatch(/http-equiv="Content-Security-Policy"/)
  })

  it('不含 unsafe-eval，且把最危险的三类收死', () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toMatch(/script-src [^;]*/)
    expect(csp).toMatch(/object-src 'none'/)
    expect(csp).toMatch(/base-uri 'none'/)
  })

  it('放行 app: 方案：皮肤素材在 app://skin（异主机），语音/字体在 app://assets', () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? ''
    for (const dir of ['media-src', 'font-src', 'img-src', 'connect-src']) {
      expect(csp, dir).toMatch(new RegExp(`${dir} [^;]*app:`))
    }
  })
})
