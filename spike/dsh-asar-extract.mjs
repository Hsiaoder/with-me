/**
 * 一次性：从 dsh-pet 打包版 app.asar 里直接切出**已经带 alpha 的原片**装成试穿皮肤。
 *
 * 为什么不抠像：asar 里发的是 yuva420p 的 VP9（实测 82.8% 像素 alpha<5、边缘干净），
 * localwork 那批黑底片是抠像前的中间产物，拿它抠才是毛刺的来源。
 * 所以这里**不重编码**，纯字节切片，画质与原版一致。
 *
 * 产物全落 %TEMP%，不进仓库（素材授权另说，见记忆 project-dafeiyu-license）。
 * 跑法：node spike/dsh-asar-extract.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ASAR = 'E:/localwork/dsh-pet-0.3.8-win-x64/resources/app.asar';
const FFMPEG = execFileSync('node', ['-e', 'process.stdout.write(require("ffmpeg-static"))']).toString();
const W = 640, H = 360;
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/**
 * 五个必需池各自挑一段：动作类型要和池的语义对得上，不然只是换个皮。
 * eat 是扩展池（喂食列表用），名字与 src/shared/food.ts 的 id 一一对应。
 * 「火锅」在素材源里叫「涮火锅」，没有「吃火锅」。
 */
const picks = [
  { pool: 'idle', name: 'breath', src: 'assets/webm/待机呼吸休闲.webm' },
  { pool: 'turn', name: 'look', src: 'assets/webm/东张西望.webm' },
  { pool: 'move', name: 'float', src: 'assets/webm/原地漂浮踏步.webm' },
  { pool: 'click', name: 'wave', src: 'assets/webm/点击回应-元气挥手.webm' },
  { pool: 'drag', name: 'grab', src: 'assets/webm/被鼠标拖拽悬空反馈.webm' },
  { pool: 'eat', name: 'token', src: 'assets/webm/吃Token.webm' },
  { pool: 'eat', name: 'rice', src: 'assets/webm/吃白饭.webm' },
  { pool: 'eat', name: 'tanghulu', src: 'assets/webm/吃糖葫芦.webm' },
  { pool: 'eat', name: 'crab', src: 'assets/webm/吃大闸蟹.webm' },
  { pool: 'eat', name: 'hotpot', src: 'assets/webm/涮火锅.webm' },
  { pool: 'eat', name: 'dumpling', src: 'assets/webm/吃饺子.webm' },
];

/* ---------- asar 读取 ---------- */

const fd = openSync(ASAR, 'r');
const head = Buffer.alloc(16);
readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const BASE = 16 + headerSize;
const headerBuf = Buffer.alloc(headerSize);
readSync(fd, headerBuf, 0, headerSize, 16);
const index = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''));

/** 把 asar 的 JSON 树摊平成 path -> {size, offset}。 */
const entries = new Map();
(function walk(node, dir) {
  for (const [k, v] of Object.entries(node.files ?? {})) {
    const p = dir ? `${dir}/${k}` : k;
    if (v.files) walk(v, p);
    else entries.set(p, { size: Number(v.size), offset: Number(v.offset) });
  }
})(index, '');

/**
 * asar 的 offset 相对 data 段整体差 1 字节（未文档化的历史包袱）。
 * 不写死 +1：在偏移附近搜 EBML magic，找到才算切对。
 */
function extract(path, dest) {
  const e = entries.get(path);
  if (!e) throw new Error(`asar 里没有 ${path}`);
  const buf = Buffer.alloc(e.size);
  readSync(fd, buf, 0, e.size, BASE + e.offset);
  const delta = buf.indexOf(EBML);
  if (delta < 0) {
    readSync(fd, buf, 0, e.size, BASE + e.offset + 1);
    if (buf.indexOf(EBML) !== 0) throw new Error(`${path} 找不到 EBML magic，切片错位`);
  } else if (delta !== 0) {
    readSync(fd, buf, 0, e.size, BASE + e.offset + delta);
    if (buf.indexOf(EBML) !== 0) throw new Error(`${path} EBML 位置对不上`);
  }
  writeFileSync(dest, buf);
  return buf.length;
}

/* ---------- 按 alpha 量包围盒 ---------- */

/** 跨 7 帧取 alpha>128 的并集框：单帧量会让伸出手臂的那几帧出框，体检会误报残留。 */
function unionBox(file) {
  const raw = join(tmpdir(), 'asar-rebox.raw');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error',
    '-c:v', 'libvpx-vp9',
    '-i', file,
    '-vf', `select='eq(n\\,2)+eq(n\\,40)+eq(n\\,80)+eq(n\\,120)+eq(n\\,160)+eq(n\\,200)+eq(n\\,230)'`,
    '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], { stdio: 'pipe' });
  const buf = readFileSync(raw);
  const size = W * H * 4;
  const n = Math.floor(buf.length / size);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  let clear = 0;
  for (let i = 0; i < n; i++) {
    const f = buf.subarray(i * size, (i + 1) * size);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = f[(y * W + x) * 4 + 3];
        if (a < 5) clear++;
        if (a > 128) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
  }
  return { x0, y0, x1, y1, frames: n, clearPct: (clear / (n * W * H) * 100).toFixed(1) };
}

/* ---------- 装皮肤 ---------- */

const seed = process.argv[2] ?? '';
const userData = seed || join(mkdtempSync(join(tmpdir(), 'dsh-asar-')), 'pet');
const skinDir = join(userData, 'skins', 'dshtry');

const boxes = [];
for (const p of picks) {
  const dir = join(skinDir, 'animation', p.pool);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${p.name}.webm`);
  const bytes = extract(p.src, dest);
  const b = unionBox(dest);
  boxes.push(b);
  console.log(`${p.pool}/${p.name}  ← ${p.src.split('/').pop()}  ${(bytes / 1024).toFixed(0)} KB  ` +
    `框 x${b.x0}-${b.x1} y${b.y0}-${b.y1}  透明底 ${b.clearPct}%`);
}

const u = boxes.reduce((a, b) => ({
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
}));
const pad = 6;
const x = Math.max(0, u.x0 - pad);
const y = Math.max(0, u.y0 - pad);
const bodyBox = { x, y, w: Math.min(W, u.x1 + pad) - x, h: Math.min(H, u.y1 + pad) - y };

const pools = {};
for (const p of picks) (pools[p.pool] ??= []).push(p.name);

writeFileSync(join(skinDir, 'manifest.json'), JSON.stringify({
  formatVersion: 1,
  name: 'DSH 原片试穿（不入库）',
  author: '直接切自 dsh-pet app.asar 的 alpha 原片，未抠像未重编码',
  canvas: { w: W, h: H, feetY: Math.min(H - 1, u.y1) },
  bodyBox,
  pools,
  hotspots: {},
}, null, 2), 'utf8');

const savePath = join(userData, 'save.json');
if (!existsSync(savePath)) {
  writeFileSync(savePath, JSON.stringify({
    version: 1, skin: 'dshtry', stats: { hunger: 80, mind: 80, clean: 80, mood: 80 }, lastSeenAt: Date.now(),
  }, null, 2), 'utf8');
}

console.log(`\nbodyBox = ${JSON.stringify(bodyBox)}  feetY = ${Math.min(H - 1, u.y1)}`);
console.log(`皮肤目录：${skinDir}`);
console.log(`userData：${userData}`);

/* ---------- 直接跑一遍透明通道体检（manifest 已落盘，bodyBox 按皮肤读） ---------- */

const { analyzeFile, listClips } = await import('../tools/alpha-report.mjs');
for (const f of listClips(skinDir)) {
  const r = analyzeFile(f, bodyBox);
  console.log(`体检 ${f.slice(skinDir.length + 1)}：${JSON.stringify(r)}`);
}

console.log(`启动：PET_USER_DATA="${userData}" npx electron .`);
