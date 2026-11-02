/**
 * `app://` 协议：页面、模块、皮肤素材都从这一套资源根里取。
 *
 * 为什么不能用 file://：Chromium 把每个 file:// 页面当不透明源，ES module 的 import 会被
 * CORS 拒掉，带 alpha 的 webm 也会被当成跨源素材。两个参考项目各有一套等价物
 * （qqpet 的 `app://`、dsh-pet 的 `dsh-pet-bridge:`）。
 *
 * 资源根按**主机名**区分（`app://assets/...`、`app://skin/...`），不按路径首段：
 * standard 协议下 Chromium 会把路径首段搬进主机位，`app:///renderer/index.html`
 * 到处理器里已经变成 `app://renderer/index.html`，按首段找根永远找不到（实测 403）。
 */
import { net, protocol } from 'electron'
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_SCHEME } from '../shared/config.js'

/** 资源根：主机名 → 绝对目录。 */
export type Roots = Record<string, string>

export type Mapped = { ok: true; file: string } | { ok: false; status: 400 | 403 | 404; reason: string }

/**
 * `app://assets/renderer/index.html` → roots.assets + /renderer/index.html
 * `app://skin/idle/patrol.webm`      → roots.skin + /idle/patrol.webm
 *
 * 越界一律拒绝，而不是静默把 `..` 剥掉——剥掉会让 `..%2f..%2fetc` 变成合法路径。
 * `new URL` 与 `decodeURIComponent` 都会对畸形输入抛异常，这里必须接住：
 * 它们在协议处理器里跑，漏出去就是一个未处理的 rejection。
 */
export function mapAppPath(roots: Roots, url: string): Mapped {
  let host: string
  let decoded: string
  try {
    const parsed = new URL(url)
    host = parsed.host
    decoded = decodeURIComponent(parsed.pathname)
  } catch {
    return { ok: false, status: 400, reason: '地址无法解析' }
  }
  const root = roots[host]
  if (!root || !isAbsolute(root)) return { ok: false, status: 403, reason: `未知的资源根：${host}` }
  const rel = decoded.replace(/^\/+/, '')
  const parts = rel.split('/').filter((s) => s !== '')
  if (!parts.length) return { ok: false, status: 404, reason: '缺少文件名' }
  if (parts.includes('..') || rel.includes('..') || rel.includes('\\')) {
    return { ok: false, status: 403, reason: '路径穿越' }
  }
  const abs = resolve(join(root, ...parts))
  if (abs !== root && !abs.startsWith(root + sep)) return { ok: false, status: 403, reason: '解析后越出资源根' }
  return { ok: true, file: abs }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.cjs': 'text/javascript; charset=utf-8',
}

/** 不给未知后缀猜 text/plain，宁可 404，避免把源码当页面渲染出去。 */
export function mimeOf(file: string): string | null {
  return MIME[extname(basename(file)).toLowerCase()] ?? null
}

/** 必须在 ready 之前调用，且整个进程只能调一次。 */
export function declareAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      // stream 让 <video> 能分段读取；standard+secure 让 ES 模块与 CSP 正常工作
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/** 必须在 ready 之后、建窗之前调用。 */
export function attachAppHandler(roots: Roots): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const mapped = mapAppPath(roots, request.url)
    if (!mapped.ok) return new Response(mapped.reason, { status: mapped.status })
    const type = mimeOf(mapped.file)
    if (!type) return new Response(`不支持的类型：${basename(mapped.file)}`, { status: 404 })
    try {
      // 交给 net.fetch 而不是自己读文件：它认 Range 头，<video> 的分段请求才有响应
      const range = request.headers.get('range')
      const upstream = await net.fetch(pathToFileURL(mapped.file).href, {
        headers: range ? { range } : {},
      })
      const headers = new Headers({ 'content-type': type })
      for (const h of ['content-length', 'content-range', 'accept-ranges']) {
        const v = upstream.headers.get(h)
        if (v) headers.set(h, v)
      }
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
