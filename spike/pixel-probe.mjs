/**
 * 一次性：把「闪」落到像素上——拖拽全程按主进程 capturePage 抓窗口内的真实合成结果，
 * 每帧数宠物占了多少像素。
 *
 * 为什么不能只看页面里的 video 状态：两个槽的 opacity 加起来一直是 1.00，
 * 说明淡入淡出本身没漏光；那用户看到的闪就不在素材层，而在窗口层
 * （舞台 transform、面板显隐、穿透开关、整窗重绘）。只有抓窗口本身能分清。
 *
 * 跑法：node spike/pixel-probe.mjs <userData目录>
 */
import { _electron as electron } from 'playwright'
import { existsSync } from 'node:fs'

const ud = process.argv[2]
if (!ud || !existsSync(ud)) { console.error('用法：node spike/pixel-probe.mjs <userData>'); process.exit(1) }

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: ud } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })

  /** 抓身体周围一块，返回「不透明像素数 + 命中框 + 当前动画 + 舞台 transform」。 */
  async function sample(label, ms) {
    const box = await page.evaluate(() => window.__petDebug.hitBox)
    const region = {
      x: Math.max(0, Math.round(box.x - 40)),
      y: Math.max(0, Math.round(box.y - 40)),
      width: Math.min(400, Math.round(box.w + 80)),
      height: Math.min(460, Math.round(box.h + 80)),
    }
    const t0 = Date.now()
    // 直方图在主进程里数完再回传：整张位图几十万个数，跨进程搬一次太慢，采样间隔就失真了
    const stat = await app.evaluate(({ BrowserWindow }, r) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.isVisible());
      return win.capturePage(r).then((img) => {
        const b = img.toBitmap();
        const { width, height } = img.getSize();
        let solid = 0, faint = 0, clear = 0, max = 0, sum = 0, n = 0;
        for (let i = 3; i < b.length; i += 4) {
          const a = b[i];
          if (a > 200) solid++; else if (a > 20) faint++; else clear++;
          if (a > max) max = a;
          if (a > 20) { sum += a; n++; }
        }
        // 关键读数不是「实心有多少」，是**最实的那一个像素有多实**：
        // 两层各自半透明叠在一起时，实心数会掉到 0，但真正说明问题的是峰值只有 ~191
        return { width, height, solid, faint, clear, max, mean: n ? Math.round(sum / n) : 0 };
      });
    }, region)
    const { solid, faint, max, mean } = stat
    const dom = await page.evaluate(() => {
      const st = document.querySelector('.pet-sprite')
      const vs = [...document.querySelectorAll('video')].map((v) => ({
        f: v.classList.contains('is-front'), op: +getComputedStyle(v).opacity, t: +v.currentTime.toFixed(2),
        clip: (v.currentSrc || '').replace('app://skin/', '').replace('.webm', ''),
      }))
      return {
        cur: window.__petDebug.current.pool + '/' + window.__petDebug.current.name,
        transform: st ? getComputedStyle(st).transform : 'no-stage',
        vis: st ? getComputedStyle(st).visibility : '?',
        frontOp: vs.find((v) => v.f)?.op ?? null,
        clips: vs.map((v) => `${v.clip}@${v.t}${v.f ? '*' : ''}`).join(' '),
        panel: window.__petDebug.panelOpen,
      }
    })
    console.log(`${String(ms).padStart(6)}ms ${label.padEnd(8)} 峰值alpha=${String(max).padStart(3)} 均值=${String(mean).padStart(3)} ` +
      `实心=${String(solid).padStart(6)} 半透=${String(faint).padStart(6)} | ${dom.cur.padEnd(12)} 前台op=${dom.frontOp} | ${dom.clips}`)
    return Date.now() - t0
  }

  console.log('静态基线：')
  await sample('起点', 0)
  await page.waitForTimeout(200)
  await sample('静止', 200)

  // 对照组：什么都不做，同样连拍 14 次。
  // 如果静止时也能抓到「全半透」那一帧，那它就是 capturePage 自己的 glitch，不是宠物在闪。
  console.log('\n对照：静止连拍')
  for (let i = 0; i < 14; i++) await sample(`静${i}`, -200 - i)

  const box = await page.evaluate(() => window.__petDebug.hitBox)
  const from = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const to = { x: from.x - 220, y: from.y - 120 }

  console.log('\n拖拽过程（合成事件，和 e2e 走同一条链路）：')
  let t = 0
  const step = async (fn, label) => { await fn(); t += 90; await page.waitForTimeout(90); await sample(label, t) }
  await step(() => page.evaluate((p) => window.dispatchEvent(new PointerEvent('pointerdown', { clientX: p.x, clientY: p.y, bubbles: true })), from), '按下')
  await step(() => page.evaluate((p) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, bubbles: true })), to), '移动')

  // 松手后立刻连拍：0.18s 的叠化只有 10 来帧，90ms 一跳会正好错过最花的那一帧
  await page.evaluate((p) => window.dispatchEvent(new PointerEvent('pointerup', { clientX: p.x, clientY: p.y, bubbles: true })), to)
  for (let i = 0; i < 14; i++) await sample(`连拍${i}`, -1 - i)
  await page.waitForTimeout(200)
  await sample('收尾', 9999)
  await step(() => Promise.resolve(), '+90ms')
  await step(() => Promise.resolve(), '+180ms')
  await step(() => Promise.resolve(), '+270ms')
  await step(() => Promise.resolve(), '+360ms')
  await step(() => Promise.resolve(), '+450ms')
  await step(() => Promise.resolve(), '+540ms')
  await step(() => Promise.resolve(), '+630ms')
  await step(() => Promise.resolve(), '+720ms')
  await step(() => Promise.resolve(), '+810ms')
} finally {
  await app.close().catch(() => {})
}
