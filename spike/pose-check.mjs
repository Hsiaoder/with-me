/**
 * 一次性：验素材有没有守「末帧回到首帧姿势」这条合同。
 *
 * 换片靠 0.18s 透明度过渡：如果新素材的首帧和旧素材的末帧不是一个姿势，
 * 这 0.18 秒里屏幕上同时有两个轮廓——观感就是「闪一下」。
 * 占位皮肤是我们自己造的，姿势恒定，所以这条一直没被真素材考过。
 *
 * 跑法：node spike/pose-check.mjs <皮肤目录>
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const FFMPEG = execFileSync('node', ['-e', 'process.stdout.write(require("ffmpeg-static"))']).toString()
const SK = process.argv[2]
if (!SK) { console.log('用法：node spike/pose-check.mjs <皮肤目录>'); process.exit(1) }
const W = 640, H = 360, SZ = W * H * 4;

/** 解出这个文件的全部帧（RGBA）。必须显式 libvpx-vp9，否则丢 alpha 量出假数。 */
function frames(file) {
  const raw = execFileSync(FFMPEG, ['-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', file,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });
  const n = Math.floor(raw.length / SZ);
  const out = [];
  for (let i = 0; i < n; i++) out.push(raw.subarray(i * SZ, (i + 1) * SZ));
  return out;
}

/** 两帧的差别：只看轮廓（alpha>128）对不上多少，再看对不上的像素离得多远。 */
function diff(a, b) {
  let both = 0, onlyA = 0, onlyB = 0, sdx = 0, sdy = 0, na = 0, nb = 0, cx = 0, cy = 0;
  for (let i = 0; i < a.length; i += 4) {
    const A = a[i + 3] > 128, B = b[i + 3] > 128;
    if (A && B) both++;
    if (A && !B) onlyA++;
    if (B && !A) onlyB++;
    if (A) { const p = i / 4; cx += p % W; cy += (p / W) | 0; na++; }
  }
  // 轮廓面积差 + 重心位移，够描述「一眼看出换了姿势」
  const ca = na ? { x: cx / na, y: cy / na } : { x: 0, y: 0 };
  let m = 0, sx2 = 0, sy2 = 0, n2 = 0;
  for (let i = 0; i < b.length; i += 4) if (b[i + 3] > 128) { const p = i / 4; sx2 += p % W; sy2 += (p / W) | 0; m++; }
  const cb = m ? { x: sx2 / m, y: sy2 / m } : { x: 0, y: 0 };
  return {
    areaA: na, areaB: m,
    // 轮廓不重合的比例（相对并集）
    mismatch: (onlyA + onlyB) / Math.max(1, both + onlyA + onlyB),
    centroidShift: Math.hypot(ca.x - cb.x, ca.y - cb.y),
  };
}

const clips = [];
for (const pool of readdirSync(join(SK, 'animation'))) {
  for (const f of readdirSync(join(SK, 'animation', pool))) {
    clips.push({ pool, name: f.replace('.webm', ''), file: join(SK, 'animation', pool, f) });
  }
}

for (const c of clips) {
  const fs = frames(c.file);
  const first = fs[0], last = fs[fs.length - 1];
  const d = diff(first, last);
  // 首帧 vs 第二帧当基线：同一姿势相邻帧本来就该差这么点
  const base = diff(first, fs[1]);
  console.log(`${c.pool}/${c.name}（${fs.length} 帧）`);
  console.log(`  首帧↔末帧：轮廓不重合 ${(d.mismatch * 100).toFixed(1)}%  重心位移 ${d.centroidShift.toFixed(1)}px  面积 ${d.areaA}→${d.areaB}`);
  console.log(`  首帧↔第2帧（基线）：轮廓不重合 ${(base.mismatch * 100).toFixed(1)}%  重心位移 ${base.centroidShift.toFixed(1)}px`);
}

/**
 * 换片那一瞬真正决定观感的是「上一段的末帧」对「下一段的首帧」。
 * 素材合同说每条都从标准正面姿势起步，那就把五段的首帧互相比一次。
 */
console.log('\n首帧互比（合同说都从标准正面姿势起步）：');
const firsts = {};
for (const c of clips) firsts[`${c.pool}/${c.name}`] = frames(c.file)[0];
const keys = Object.keys(firsts);
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    const d = diff(firsts[keys[i]], firsts[keys[j]]);
    console.log(`  ${keys[i]} ↔ ${keys[j]}：轮廓不重合 ${(d.mismatch * 100).toFixed(1)}%  重心位移 ${d.centroidShift.toFixed(1)}px`);
  }
}
