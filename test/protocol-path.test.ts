import { describe, it, expect } from 'vitest'
import { join, resolve } from 'node:path'
import { mapAppPath, mimeOf, type Roots } from '../src/main/protocol.js'

// 断言两边都过 resolve()，否则 Windows 上 '/app/dist' 会被解析成 'C:\\app\\dist'，
// 测试会因为平台路径风格而失败，而不是因为逻辑错了。
const ASSETS = resolve('app-dist')
const SKIN = resolve(join('data', 'skins', 'block', 'animation'))
const roots: Roots = { assets: ASSETS, skin: SKIN }

describe('mapAppPath', () => {
  it('主机名选资源根，路径按相对拼接到该根下', () => {
    expect(mapAppPath(roots, 'app://assets/renderer/index.html')).toEqual({
      ok: true,
      file: resolve('app-dist/renderer/index.html'),
    })
  })

  it('渲染层的相对 import 解析后仍在 assets 根内', () => {
    // 页面 app://assets/renderer/index.js 里写 '../shared/config.js'
    expect(mapAppPath(roots, new URL('../shared/config.js', 'app://assets/renderer/index.js').href)).toEqual({
      ok: true,
      file: resolve('app-dist/shared/config.js'),
    })
  })

  it('皮肤素材走 skin 根，多级子目录保留', () => {
    expect(mapAppPath(roots, 'app://skin/idle/patrol.webm')).toEqual({
      ok: true,
      file: resolve(join('data', 'skins', 'block', 'animation', 'idle', 'patrol.webm')),
    })
  })

  it('路径首段形式的旧地址不再工作：Chromium 会把它搬进主机位', () => {
    // app:///renderer/index.html 到协议处理器里已经是 app://renderer/index.html，
    // 而 renderer 不是注册过的根。这条测试记录的是踩过的坑，别改回按首段找根。
    expect(mapAppPath(roots, 'app://renderer/index.html')).toMatchObject({ ok: false, status: 403 })
  })

  it('未编码的 .. 在 URL 解析阶段就被消掉，落点仍在资源根内', () => {
    // new URL() 会规范化路径，'..' 到不了 mapAppPath。所以这类地址不会跳出根目录，
    // 但也不会被判 403——真正需要拦的是下面那种编码过的。
    expect(mapAppPath(roots, 'app://skin/../manifest.json')).toEqual({
      ok: true,
      file: resolve(join('data', 'skins', 'block', 'animation', 'manifest.json')),
    })
    expect(mapAppPath(roots, 'app://assets/../../etc/passwd')).toEqual({
      ok: true,
      file: resolve('app-dist/etc/passwd'),
    })
    // 整段的 %2e%2e 同样会被按「双点段」移除，落点还是在根里面
    expect(mapAppPath(roots, 'app://skin/%2e%2e/%2e%2e/etc/passwd')).toEqual({
      ok: true,
      file: resolve(join('data', 'skins', 'block', 'animation', 'etc/passwd')),
    })
  })

  it('编码后仍留在同一段里的穿越一律 403（decodeURIComponent 之后再判）', () => {
    // %2f 不会被 URL 解析成路径分隔符，解码后才露出 '..'——这才是真正要拦的那类。
    expect(mapAppPath(roots, 'app://assets/%2e%2e%2f%2e%2e%2fwin.ini')).toMatchObject({ ok: false, status: 403 })
    expect(mapAppPath(roots, 'app://skin/..%5c..%5cwindows%5csystem32')).toMatchObject({ ok: false, status: 403 })
  })

  it('未知主机名 403，缺文件名 404', () => {
    expect(mapAppPath(roots, 'app://other/x.js')).toMatchObject({ ok: false, status: 403 })
    expect(mapAppPath(roots, 'app://skin/')).toMatchObject({ ok: false, status: 404 })
    expect(mapAppPath(roots, 'app://skin///')).toMatchObject({ ok: false, status: 404 })
  })

  it('资源根不是绝对路径时拒绝服务，防止拼出意外位置', () => {
    expect(mapAppPath({ bad: 'relative/dir' }, 'app://bad/x.js')).toMatchObject({ ok: false, status: 403 })
  })

  it('畸形地址返回 400 而不是抛异常——它在协议处理器里跑，漏出去就是未处理 rejection', () => {
    // decodeURIComponent 对坏转义抛 URIError
    expect(mapAppPath(roots, 'app://skin/%e0%a4%')).toMatchObject({ ok: false, status: 400 })
    // new URL 对非 URL 抛 TypeError
    expect(mapAppPath(roots, 'not a url at all')).toMatchObject({ ok: false, status: 400 })
    expect(mapAppPath(roots, '')).toMatchObject({ ok: false, status: 400 })
  })

  it('mimeOf 只认白名单后缀', () => {
    expect(mimeOf('a/b.webm')).toBe('video/webm')
    expect(mimeOf('a/B.WEBM')).toBe('video/webm')
    expect(mimeOf('a/b.txt')).toBeNull()
    expect(mimeOf('a/b')).toBeNull()
  })
})
