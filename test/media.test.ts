import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MEDIA_PROBE_SCRIPT, parseMediaSample } from '../src/shared/media.js'
import { APP_AUMID } from '../src/shared/config.js'

/**
 * 播放器探测的契约。
 *
 * 这段唯一难复现的地方是「真有一个播放器在放」——所以解析和脚本都做成可测的纯东西：
 * 脚本真的跑一次由 e2e 的「可见性探测子进程」同款手段兜底（起得来、不闪窗、退出不留孤儿）。
 */
describe('媒体探测 · 行解析', () => {
  it('0 = 没在放', () => {
    expect(parseMediaSample('0')).toEqual({ playing: false, app: '' })
    expect(parseMediaSample('  0  ')).toEqual({ playing: false, app: '' })
  })

  it('1 <app> = 在放；AUMID 里带空格也整段照收', () => {
    expect(parseMediaSample('1 Chrome')).toEqual({ playing: true, app: 'Chrome' })
    expect(parseMediaSample('1 Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic'))
      .toEqual({ playing: true, app: 'Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic' })
    expect(parseMediaSample('1 Foo Bar Baz')).toEqual({ playing: true, app: 'Foo Bar Baz' })
  })

  it('认不出来就 null：调用方保持上一次状态，不会把垃圾行当成「停了」', () => {
    for (const bad of ['', '   ', '1', '1 ', 'true', '2 Chrome', '0 Chrome', 'x1 Chrome', '1\tChrome']) {
      expect(parseMediaSample(bad), `应该认不出：${JSON.stringify(bad)}`).toBeNull()
    }
  })

  it('app 过长截到 120 字：只是防脏数据，不参与判断', () => {
    const s = parseMediaSample('1 ' + 'a'.repeat(500))
    expect(s?.playing).toBe(true)
    expect(s?.app.length).toBe(120)
  })
})

describe('媒体探测 · 脚本', () => {
  it('唯一的拼接值是父进程 PID，且脚本是纯 ASCII（WinPS 5.1 读不了中文 .ps1）', () => {
    const script = MEDIA_PROBE_SCRIPT(4242)
    expect(script).toContain('$parent = 4242')
    expect(/[^\x00-\x7f]/.test(script), '脚本里有非 ASCII 字符').toBe(false)
  })

  it('自己的 AUMID 走环境变量，不拼进脚本源码', () => {
    const script = MEDIA_PROBE_SCRIPT(1)
    expect(script).toContain('$env:PET_OWN_AUMID')
    expect(script).not.toContain(APP_AUMID)
  })

  it('脚本会跳过自己的会话（否则自己的台词语音会把自己掐掉）', () => {
    const script = MEDIA_PROBE_SCRIPT(1)
    expect(script).toContain('if ($own -and $id -eq $own) { continue }')
  })

  it('APP_AUMID 与 electron-builder 的 appId 一致', () => {
    const yml = readFileSync('electron-builder.yml', 'utf8')
    expect(yml).toContain(`appId: ${APP_AUMID}`)
  })

  it('问的是系统媒体会话，看的是 Playing，且父进程没了自己退', () => {
    const script = MEDIA_PROBE_SCRIPT(1)
    expect(script).toContain('GlobalSystemMediaTransportControlsSessionManager')
    expect(script).toContain("'Playing'")
    expect(script).toContain('Get-Process -Id $parent')
  })
})
