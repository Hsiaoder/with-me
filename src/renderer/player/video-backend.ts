import type { ClipPlayer, ClipRef, PlayResult } from './clip-player.js'

/**
 * 两个 <video> 轮流当前台。四条铁律逐条落在代码上：
 * ① 新素材 `loadeddata` 之后才切换，不在赋值 src 那一刻切
 * ② 每次 play / cancel 递增代际号，所有异步回调先核对，过期就丢
 * ③ 退位的 video 立刻摘掉 `onended`，否则它在后台播完会把当前动画杀掉
 * ④ 切换靠 class `is-front`，0.18s 透明度过渡在 style.css 里（这里只管挂摘）
 *
 * 素材地址由调用方给（`urlFor`），本模块不认识 app://、也不认识皮肤目录，
 * 这样 Task 10 拼地址、这里只管换画面。
 */

export type VideoPlayerOptions = {
  /** 舞台容器，两个 video 挂在它下面。 */
  stage: HTMLElement
  /** ref → 素材 URL。 */
  urlFor: (ref: ClipRef) => string
}

type Slot = { video: HTMLVideoElement; ref: ClipRef | null }

const clipKey = (ref: ClipRef): string => `${ref.pool}/${ref.name}`

export function createVideoPlayer(opts: VideoPlayerOptions): ClipPlayer {
  const { stage, urlFor } = opts

  const makeSlot = (front: boolean): Slot => {
    const video = document.createElement('video')
    video.className = front ? 'pet-video is-front' : 'pet-video'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    stage.append(video)
    return { video, ref: null }
  }

  let frontSlot = makeSlot(true)
  let backSlot = makeSlot(false)
  let generation = 0
  let current: ClipRef | null = null
  /** 唯一一个 pending：谁持有它，谁就是当前那次 play 的收尾人。 */
  let pending: { resolve: (r: PlayResult) => void; gen: number } | null = null

  const settle = (r: PlayResult): void => {
    const done = pending
    pending = null
    done?.resolve(r)
  }

  /** 铁律②：回调可能来自已经被作废的那次 play。 */
  const isStale = (gen: number): boolean => gen !== generation

  /** 铁律①③：门控在这里，退位的先摘 ended。 */
  function promote(target: Slot): void {
    const retiring = frontSlot
    retiring.video.classList.remove('is-front')
    retiring.video.onended = null
    retiring.video.pause()

    target.video.classList.add('is-front')
    frontSlot = target
    backSlot = retiring
  }

  function loadInto(slot: Slot, ref: ClipRef): void {
    if (slot.ref && clipKey(slot.ref) === clipKey(ref)) return
    slot.ref = ref
    slot.video.src = urlFor(ref)
    slot.video.load()
  }

  return {
    get current() {
      return current
    },
    get generation() {
      return generation
    },

    prepare(ref) {
      loadInto(backSlot, ref)
    },

    play(ref, playOpts) {
      const once = playOpts?.once ?? false
      generation++
      const myGen = generation
      current = ref
      settle('cancelled')

      const target = backSlot
      loadInto(target, ref)
      target.video.loop = !once

      return new Promise<PlayResult>((resolve) => {
        pending = { resolve, gen: myGen }

        const finish = (r: PlayResult): void => {
          if (isStale(myGen) || pending?.gen !== myGen) return
          settle(r)
        }

        const fail = (): void => finish('cancelled')

        const start = (): void => {
          if (isStale(myGen)) return
          target.video.removeEventListener('error', fail)
          promote(target)
          target.video.onended = once ? () => finish('ended') : null
          // play() 可能被自动播放策略拒绝，这里不许留未处理的 rejection
          target.video.play().catch(() => finish('cancelled'))
        }

        // 素材损坏或文件不见了：没有这条兜底，play() 的 Promise 会永远悬着
        target.video.addEventListener('error', fail, { once: true })

        // 已经解码出首帧就直接切，别再等一轮 loadeddata
        if (target.video.readyState >= 2) start()
        else target.video.addEventListener('loadeddata', start, { once: true })
      })
    },

    cancel() {
      generation++
      settle('cancelled')
      // 前台画面继续放着：每次 cancel 后面都紧跟一次 play，停住反而会看见一帧冻图
    },

    destroy() {
      generation++
      settle('cancelled')
      frontSlot.video.remove()
      backSlot.video.remove()
      current = null
    },
  }
}
