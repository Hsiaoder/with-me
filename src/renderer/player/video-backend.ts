import type { ClipPlayer, PlayResult } from './clip-player.js'
import type { ClipRef } from '../../shared/types.js'
import { CLIP_FADE_MS } from '../../shared/config.js'

/**
 * 两个 <video> 轮流当前台。四条铁律逐条落在代码上：
 * ① 新素材 `loadeddata` 之后才切换，不在赋值 src 那一刻切
 * ② 每次 play / cancel 递增代际号，所有异步回调先核对，过期就丢
 * ③ 退位的 video 立刻摘掉 `onended`，否则它在后台播完会把当前动画杀掉
 * ④ 换片只动一层：新层满不透明压在下边，旧层 `is-out` 盖在上边淡出 0.18s
 *   （时长取自 config 的 CLIP_FADE_MS，样式在 style.css）。两层同时淡会叠出
 *   0.75 的半透明，桌面从宠物身上透过去——那是「闪一下」的成因，不是解法。
 *
 * 外加一条规格硬约束：**绝不设置 `video.loop`**。spike 实测它每次回到起点都要重新缓冲，
 * 重复播放由行为层再调一次 play() 完成（见 renderer/index.ts 的行为链）。
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

  /**
   * 铁律①③：门控在这里，退位的先摘 ended。
   *
   * 交接只让**退场那一层**做透明度过渡：新层直接满不透明压在下边，旧层满不透明盖在
   * 上面淡出，淡到 0 之后再摘掉。两层同时淡会在中间合成出 0.75 的不透明度，
   * 桌面从宠物身上透过去——那就是「每次换片都闪一下」的成因。
   */
  function promote(target: Slot, gen: number): void {
    const retiring = frontSlot
    retiring.video.classList.remove('is-front')
    retiring.video.onended = null
    retiring.video.pause()

    // 空槽退位（首次装载）没什么可淡的，别给它盖一层还在动的退场幕
    if (retiring.ref !== null) {
      retiring.video.classList.add('is-out')
      window.setTimeout(() => {
        // 代际号不符说明已经有新一轮交接，收尾交给那一轮去做
        if (gen !== generation) return
        retiring.video.classList.remove('is-out')
      }, CLIP_FADE_MS)
    }

    target.video.classList.remove('is-out')
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

    play(ref) {
      generation++
      const myGen = generation
      current = ref
      settle('cancelled')

      const target = backSlot
      loadInto(target, ref)

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
          promote(target, myGen)
          // 素材合同保证末帧回到首帧姿势，所以「等 ended 再播下一条」在循环时看不出接缝。
          // 等 loadeddata 期间旧前台停在最后一帧——也就是首帧那一姿势，不会露白。
          target.video.onended = () => finish('ended')
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
