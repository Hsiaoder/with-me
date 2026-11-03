/**
 * 一次性：拖拽松手那一下「闪」的是什么——把过渡期间的每一帧摊开看。
 *
 * 页面里两个 <video> 叠着，靠 0.18s 透明度过渡换手。可能出两种观感：
 *   · 眨眼：那一瞬两块都不透明（总覆盖面积掉下去）
 *   · 重影：那一瞬两块各半透明且姿势不同（同时看见两个轮廓）
 * 用 rAF 每帧量两个槽的 opacity + 各自轮廓面积/重心，就能分辨。
 *
 * 自检：探针先跑一次「已知会发生」的换片（__testPlay），
 * 若它连那次过渡的 opacity 中间值都读不到，说明探针是瞎的，后面所有结论作废。
 * 跑法：node spike/flash-probe.mjs <userData目录>
 */
import { _electron as electron } from 'playwright'
import { existsSync } from 'node:fs'

const ud = process.argv[2]
if (!ud || !existsSync(ud)) {
  console.error('用法：node spike/flash-probe.mjs <userData目录>')
  process.exit(1)
}

/** 注进页面：每帧记两个槽的 opacity / 时间 / 轮廓面积与重心。 */
function startProbe() {
  const w = window;
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  function shape(v) {
    try {
      ctx.clearRect(0, 0, 160, 90);
      ctx.drawImage(v, 0, 0, 160, 90);
      const d = ctx.getImageData(0, 0, 160, 90).data;
      let n = 0, sx = 0, sy = 0, top = 90, bottom = -1;
      for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) {
        if (d[(y * 160 + x) * 4 + 3] > 128) { n++; sx += x; sy += y; if (y < top) top = y; if (y > bottom) bottom = y; }
      }
      return n ? { area: n, cx: sx / n, cy: sy / n, top, bottom } : { area: 0, top: -1, bottom: -1 };
    } catch (e) { return { err: String(e).slice(0, 50) }; }
  }
  const rows = [];
  let t0 = 0;
  function step(ts) {
    if (!t0) t0 = ts;
    const cur = w.__petDebug.current;
    const r = { ms: Math.round(ts - t0), cur: cur.pool + '/' + cur.name };
    for (const v of document.querySelectorAll('video')) {
      r[v.classList.contains('is-front') ? 'F' : 'B'] =
        { op: +getComputedStyle(v).opacity, t: +v.currentTime.toFixed(2), rs: v.readyState, ended: v.ended,
          clip: (v.currentSrc || '').replace('app://skin/', '').replace('.webm', ''), ...shape(v) };
    }
    rows.push(r);
    if (rows.length < 5000) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  w.__flash = rows;
  return rows.length;
}

const fmt = (s) => s
  ? `${(s.clip ?? '?').padEnd(11)} op=${s.op.toFixed(2)} t=${s.t.toFixed(2)}${s.ended ? ' ENDED' : ''}`
  : '—';

async function dump(page, label) {
  const rows = await page.evaluate(() => {
    if (!window.__flash) return null;
    const r = window.__flash.slice();
    window.__flash.length = 0;
    return r;
  });
  if (!rows) { console.log(`\n===== ${label}：探针没在跑，作废 =====`); return; }
  console.log(`\n===== ${label}（${rows.length} 帧）=====`);
  let prevKey = '';
  let shown = 0;
  for (const r of rows) {
    // 只在「有得看」的帧打点：任一槽半透明，或换了片
    const fading = (r.F && r.F.op > 0.02 && r.F.op < 0.98) || (r.B && r.B.op > 0.02 && r.B.op < 0.98);
    const key = `${r.cur}|${r.F?.op?.toFixed(2)}|${r.B?.op?.toFixed(2)}`;
    if (!fading && key === prevKey) { prevKey = key; continue; }
    prevKey = key;
    const shift = r.F?.clip && r.B?.clip && r.F.clip !== r.B.clip;
    console.log(`${String(r.ms).padStart(5)}ms ${r.cur.padEnd(15)} 前[${fmt(r.F)}] 后[${fmt(r.B)}]${shift ? '  ←两条不同素材在叠化' : ''}`);
    if (++shown > 40) { console.log('……（截断）'); break; }
  }
  if (!shown) console.log('（这段里没有半透明帧：要么没发生过渡，要么探针读不到 opacity）');
}

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: ud } });
try {
  const page = await app.firstWindow();
  page.on('console', (m) => console.log(`  [页面] ${m.text()}`));
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 });
  console.log('探针注入：', await page.evaluate(startProbe));

  // 自检：一次已知会过渡的换片，探针必须读出 opacity 中间值。
  // 注意别 return 那个 promise——它要等整条素材播完才 resolve，会把时序全搅乱。
  await page.evaluate(() => { void window.__testPlay('click', 'wave'); });
  await page.waitForTimeout(900);
  await dump(page, '自检：__testPlay → click/wave');

  // 被测：真走一遍拖拽（松手会 requestClip('drag')）
  const box = await page.evaluate(() => window.__petDebug.hitBox);
  const from = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const to = { x: from.x - 200, y: from.y - 100 };
  await page.evaluate(async ({ from, to }) => {
    const fire = (type, p) => window.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, bubbles: true }));
    fire('pointerdown', from);
    fire('pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    fire('pointermove', to);
    await new Promise((r) => setTimeout(r, 300));
    fire('pointerup', to);

  }, { from, to });
  await page.waitForTimeout(3000);
  await dump(page, '拖拽松手前后');

  // 连着拖两次：第二次松手时，drag 段还在播
  await page.evaluate(async ({ from, to }) => {
    const fire = (type, p) => window.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, bubbles: true }));
    fire('pointerdown', from);
    fire('pointermove', to);
    await new Promise((r) => setTimeout(r, 200));
    fire('pointerup', to);
  }, { from, to });
  await page.waitForTimeout(2500);
  await dump(page, '紧接着再拖一次');
} finally {
  await app.close().catch(() => {});
}
