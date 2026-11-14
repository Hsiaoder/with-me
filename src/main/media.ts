import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { APP_AUMID } from '../shared/config.js'
import { MEDIA_PROBE_SCRIPT, parseMediaSample } from '../shared/media.js'

/**
 * 「有没有播放器在放东西」的探测进程。
 *
 * 和可见性探测同一条路子：常驻 PowerShell 子进程只报事实（一秒一行），
 * 这里只做去抖和转发——拿它干嘛（动画权重）是渲染层的事。
 *
 * 起不来 / 系统没有媒体服务时静默降级：这只宠物少一个彩蛋，不该因此起不来。
 */
export interface MediaWatch {
  stop(): void
}

export function startMediaWatch(onPlaying: (playing: boolean) => void): MediaWatch {
  if (process.platform !== 'win32') return { stop() {} }
  // e2e 要确定性：这台机器上真放着歌就会改日常动画的权重，测试里把这条线关掉。
  if (process.env.PET_NO_MEDIA === '1') return { stop() {} }

  let child: ChildProcess | null = null
  let stopped = false
  let last: boolean | null = null

  try {
    const encoded = Buffer.from(MEDIA_PROBE_SCRIPT(process.pid), 'utf16le').toString('base64')
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      // 子进程靠它把自己登记的那个会话排掉：Chromium 给 <audio> 建的 SMTC 会话
      // AUMID 就是我们 app.setAppUserModelId 设的值（见 shared/config.ts 的 APP_AUMID）。
      env: { ...process.env, PET_OWN_AUMID: APP_AUMID },
    })
  } catch (e) {
    console.error('[media] 播放器探测进程起不来，音乐动画关掉但宠物照常：', e)
    return { stop() {} }
  }

  child.on('error', (e) => console.error('[media] 播放器探测出错，音乐动画关掉但宠物照常：', e))
  child.on('exit', () => {
    if (!stopped) console.log('[media] 播放器探测进程退出，音乐动画关掉')
  })

  if (child.stdout) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (stopped) return
      const sample = parseMediaSample(line)
      if (sample === null) return
      if (sample.playing === last) return
      last = sample.playing
      // 留一行痕迹：用户报「宠物怎么突然开始哼歌」时，这条就是第一手证据。
      console.log(sample.playing ? `[media] 开始播放：${sample.app}` : '[media] 停止播放')
      onPlaying(sample.playing)
    })
  }

  return {
    stop() {
      stopped = true
      child?.kill()
      child = null
    },
  }
}
