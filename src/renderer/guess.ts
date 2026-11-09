/**
 * 「猜动作」渲染层控制器。和「鲸鲸会飞」同一套游戏态接口 `{active,start,stop,hudRect}`，
 * 但它**不接管拖拽**——一局固定 10 道题，让宠物做一个动作、浮出 3 个选项按钮，玩家点「它刚做的是哪个」。
 *
 * 纯逻辑（动作库、抽题、配选项）在 `shared/guess.ts`；这里只管摆浮层、播动画、记分、退出结算。
 * 动画每题先播一遍；若 `REPLAY_AFTER_MS`（比 dsh 原片约 10s 略长）到点还没人答，就**在播完之后**再重放一遍，直到答为止。
 * 节拍取得比片长长是关键——以前那个 2400ms 定时器比 10s 短太多，会在片子还在播时从头重启（用户 2026-11-08 报「播到一半就重新播放」）。
 */
import { buildRound, pickTargets, GUESS_QUESTIONS, type GuessAction, type Round } from '../shared/guess.js'
import type { ClipRef, Rect } from '../shared/types.js'

export type GuessGameDeps = {
  root: HTMLElement
  /** 让宠物播**这一条**动作（按库里的 pool+name 寻址，不是随机池里挑一条）。 */
  playClip: (action: GuessAction) => void
  /** 退出时按这一局答对数结算（count 会在 stats 里封顶）。 */
  reward: (count: number) => void
  onExit: () => void
  /** 抽题/配选项的随机源，e2e/单测注入定值，生产用 Math.random。 */
  rng?: () => number
}

/** 答完到下一题的停顿，留出「对/错」的反馈时间。 */
const NEXT_ROUND_MS = 700
/** 最后一题答完，总分停留多久再自动收摊回普通态（结算也在这一步）。 */
const FINAL_MS = 1600

export function createGuessGame(deps: GuessGameDeps) {
  const rng = deps.rng ?? Math.random
  let state: 'off' | 'playing' | 'done' = 'off'
  let deck: GuessAction[] = []
  let total = 0
  let qIndex = 0
  let round: Round | null = null
  let correct = 0
  let answered = false
  let hud: HTMLElement | null = null
  let scoreEl: HTMLElement | null = null
  let optionsEl: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function hudRect(): Rect | null {
    if (!hud) return null
    const r = hud.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }

  function buildHud(): void {
    hud = document.createElement('div')
    hud.className = 'pet-guess-hud'
    hud.dataset.hit = ''
    const score = document.createElement('div')
    score.className = 'pet-guess-score'
    scoreEl = document.createElement('b')            // e2e 读这颗 <b> 当「答对数」
    score.append(scoreEl)
    optionsEl = document.createElement('div')
    optionsEl.className = 'pet-guess-options'
    const exit = document.createElement('button')
    exit.className = 'pet-guess-exit'
    exit.type = 'button'
    exit.dataset.id = 'guess-exit'
    exit.textContent = '退出游戏'
    exit.addEventListener('click', () => stop())
    hud.append(score, optionsEl, exit)
    deps.root.append(hud)
  }

  /** 记分行：进行中是「第 m/总数 · 正确 n/总数」；<b> 里始终是答对数 n（e2e 认这颗）。 */
  function renderScore(): void {
    if (!scoreEl || !hud) return
    const score = hud.querySelector('.pet-guess-score')
    if (!score) return
    score.textContent = `第 ${Math.min(qIndex + 1, total)}/${total}题 · 正确 `
    score.append(scoreEl)
    scoreEl.textContent = String(correct)
    score.append(document.createTextNode(`/${total}`))
  }

  function renderOptions(): void {
    if (!optionsEl || !round) return
    optionsEl.replaceChildren()
    optionsEl.style.display = ''
    for (const opt of round.options) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'pet-guess-opt'
      b.dataset.id = 'guess-opt'
      b.dataset.name = opt.name
      b.textContent = opt.label
      b.addEventListener('click', () => answer(opt.name, b))
      optionsEl.append(b)
    }
  }

  /** 进下一题：抽完 10 道就收；否则配选项、把目标动作**播一遍**。 */
  function nextQuestion(): void {
    if (state !== 'playing') return
    if (qIndex >= deck.length) { finish(); return }
    round = buildRound(deck[qIndex]!, rng)
    answered = false
    renderScore()
    renderOptions()
    // 播一遍就起链；「播完没答就无缝重放」由行为链在真·ended 那一拍按 loopRef() 续挂同一条，
    // 不再用自造定时器（定时器会比片长短，切进播放中重启；也保证不了不掉回 idle）。
    deps.playClip(round.target)
  }

  function answer(name: string, btn: HTMLButtonElement): void {
    if (state !== 'playing' || answered || !round) return
    answered = true
    const right = name === round.target.name
    if (right) correct++
    renderScore()
    // 把对错说出来：选中的那颗标对/错，正确那颗也亮一下（点错时告诉用户答案是哪个）。
    btn.classList.add(right ? 'is-right' : 'is-wrong')
    if (!right) {
      const rightBtn = optionsEl?.querySelector<HTMLButtonElement>(`[data-name="${round.target.name}"]`)
      rightBtn?.classList.add('is-right')
    }
    for (const b of optionsEl?.querySelectorAll<HTMLButtonElement>('button') ?? []) b.disabled = true
    qIndex++
    timer = setTimeout(nextQuestion, NEXT_ROUND_MS)
  }

  /** 10 题问完：撤掉选项、把总分钉在记分行上停一会儿，再自动 stop()（结算走 stop 那条）。 */
  function finish(): void {
    if (state !== 'playing') return
    state = 'done'
    round = null
    if (optionsEl) { optionsEl.replaceChildren(); optionsEl.style.display = 'none' }
    if (scoreEl && hud) {
      const score = hud.querySelector('.pet-guess-score')
      if (score) {
        score.textContent = `本局答对 `
        score.append(scoreEl)
        scoreEl.textContent = String(correct)
        score.append(document.createTextNode(`/${total}`))
      }
    }
    timer = setTimeout(stop, FINAL_MS)
  }

  function start(): void {
    if (state !== 'off') return
    state = 'playing'
    correct = 0
    qIndex = 0
    deck = pickTargets(rng, GUESS_QUESTIONS)
    total = deck.length
    buildHud()
    nextQuestion()
  }

  function stop(): void {
    if (state === 'off') return
    state = 'off'
    if (timer !== null) { clearTimeout(timer); timer = null }
    hud?.remove()
    hud = null
    scoreEl = optionsEl = null
    round = null
    deps.onExit()
    // 「玩完之后」按答对数结算（和飞一样放在 onExit 之后，飘字才贴在回到普通态的身子上）。
    const scored = correct
    correct = 0
    if (scored > 0) deps.reward(scored)
  }

  return {
    active: () => state !== 'off',
    start,
    stop,
    hudRect,
    /** 当前这题真做的动作 name（e2e 用它点对的那颗；一池多名，只有 name 唯一）。 */
    targetName: () => round?.target.name ?? null,
    /**
     * 「正在考、且还没答」的目标 clip 引用——行为链在每条 clip 真播完那一拍读它：
     * 只要这里还给出这条，就无缝续挂同一条（不进 idle），直到玩家作答或退出。没在考就返回 null，交回正常决策。
     */
    loopRef: (): ClipRef | null =>
      state === 'playing' && round && !answered ? { pool: round.target.pool, name: round.target.name } : null,
  }
}
