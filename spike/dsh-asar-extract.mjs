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
 * eat 是扩展池（喂食列表用），名字与 src/shared/food.ts 的 anim.name 一一对应（16 条全列，
 * 少一条 manifest 就会漏声明、那一格点下去没吃相）。
 * 「火锅」在素材源里叫「涮火锅」，没有「吃火锅」；「零食」用「大口吃零食」。
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
  { pool: 'eat', name: 'lunch', src: 'assets/webm/吃午餐.webm' },
  { pool: 'eat', name: 'breakfast', src: 'assets/webm/吃早餐.webm' },
  { pool: 'eat', name: 'dinner', src: 'assets/webm/吃晚餐.webm' },
  { pool: 'eat', name: 'watermelon', src: 'assets/webm/吃西瓜.webm' },
  { pool: 'eat', name: 'snack', src: 'assets/webm/大口吃零食.webm' },
  { pool: 'eat', name: 'ricecake', src: 'assets/webm/吃年糕.webm' },
  { pool: 'eat', name: 'tangyuan', src: 'assets/webm/吃汤圆.webm' },
  { pool: 'eat', name: 'qingtuan', src: 'assets/webm/吃青团.webm' },
  { pool: 'eat', name: 'labaporridge', src: 'assets/webm/吃腊八粥.webm' },
  { pool: 'eat', name: 'icecream', src: 'assets/webm/吃冰淇淋融化.webm' },
  // 「猜动作」专用池（20 条，5 类，无「吃东西」）：src/shared/guess.ts 按 name 逐条寻址播放。
  // 这些只是被游戏点播的特效片，不参与宠物日常姿态，也不计进 bodyBox（见下面装配段的 pool!=='guess' 分支）。
  { pool: 'guess', name: 'tsundere', src: 'assets/webm/点击回应-傲娇生气.webm' },
  { pool: 'guess', name: 'shocked', src: 'assets/webm/点击回应-害羞惊讶.webm' },
  { pool: 'guess', name: 'cheerful', src: 'assets/webm/点击回应-开心跃动.webm' },
  { pool: 'guess', name: 'ticklish', src: 'assets/webm/点击回应-挠痒咯咯笑.webm' },
  { pool: 'guess', name: 'dove', src: 'assets/webm/变鸽子.webm' },
  { pool: 'guess', name: 'whalebubbles', src: 'assets/webm/鲸鱼吐泡泡特效.webm' },
  { pool: 'guess', name: 'flowers', src: 'assets/webm/凭空生花.webm' },
  { pool: 'guess', name: 'bluewhale', src: 'assets/webm/蓝鲸现世.webm' },
  { pool: 'guess', name: 'maid', src: 'assets/webm/优雅女仆舞.webm' },
  { pool: 'guess', name: 'flute', src: 'assets/webm/吹笛子.webm' },
  { pool: 'guess', name: 'violin', src: 'assets/webm/小提琴演奏.webm' },
  { pool: 'guess', name: 'swing', src: 'assets/webm/轻快摇摆舞.webm' },
  { pool: 'guess', name: 'otaku', src: 'assets/webm/可爱宅舞.webm' },
  { pool: 'guess', name: 'liondance', src: 'assets/webm/舞狮头.webm' },
  { pool: 'guess', name: 'skylantern', src: 'assets/webm/放孔明灯.webm' },
  { pool: 'guess', name: 'fireworks', src: 'assets/webm/放烟花.webm' },
  { pool: 'guess', name: 'riverlamp', src: 'assets/webm/放河灯.webm' },
  { pool: 'guess', name: 'juggling', src: 'assets/webm/三球抛接.webm' },
  { pool: 'guess', name: 'balloon', src: 'assets/webm/吹气球.webm' },
  { pool: 'guess', name: 'spinningtop', src: 'assets/webm/抽陀螺.webm' },
  // 「日常动画」选择器（src/shared/animation.ts）要的具名片段，全进 daily 池：按条件/说话档点播。
  // 这些只是被点播的日常/反应/配话片，不参与宠物日常姿态、也不计进 bodyBox（大伸展/荡秋千那种张开框会撑歪锚点）。
  { pool: 'daily', name: 'toycar', src: 'assets/webm/原地蹲下玩玩具汽车.webm' },
  { pool: 'daily', name: 'horse', src: 'assets/webm/骑木马.webm' },
  { pool: 'daily', name: 'swingset', src: 'assets/webm/荡秋千.webm' },
  { pool: 'daily', name: 'gift', src: 'assets/webm/拆礼物.webm' },
  { pool: 'daily', name: 'mirror', src: 'assets/webm/照镜子.webm' },
  { pool: 'daily', name: 'spin', src: 'assets/webm/小幅度原地360度旋转展示.webm' },
  { pool: 'daily', name: 'code', src: 'assets/webm/写代码.webm' },
  { pool: 'daily', name: 'cat', src: 'assets/webm/撸猫.webm' },
  { pool: 'daily', name: 'shuttlecock', src: 'assets/webm/踢毽子.webm' },
  { pool: 'daily', name: 'purseempty', src: 'assets/webm/余额-袋空如洗.webm' },
  { pool: 'daily', name: 'busytype', src: 'assets/webm/工作状态-忙碌点按.webm' },
  { pool: 'daily', name: 'siesta', src: 'assets/webm/原地小憩沉眠.webm' },
  { pool: 'daily', name: 'yawn', src: 'assets/webm/哈欠连天.webm' },
  { pool: 'daily', name: 'squat', src: 'assets/webm/原地重力下蹲压缩.webm' },
  { pool: 'daily', name: 'hum', src: 'assets/webm/悠闲哼歌.webm' },
  { pool: 'daily', name: 'tailslap', src: 'assets/webm/用鲸鱼尾巴拍打地面.webm' },
  { pool: 'daily', name: 'dozewake', src: 'assets/webm/打瞌睡被惊醒.webm' },
  { pool: 'daily', name: 'musedaze', src: 'assets/webm/碎碎念-发呆碎碎念.webm' },
  { pool: 'daily', name: 'musescreen', src: 'assets/webm/碎碎念-对屏碎碎念.webm' },
  { pool: 'daily', name: 'musewipe', src: 'assets/webm/碎碎念-擦桌碎碎念.webm' },
  { pool: 'daily', name: 'desktap', src: 'assets/webm/原地敲击桌面互动.webm' },
  { pool: 'daily', name: 'stretch', src: 'assets/webm/超大伸懒腰.webm' },
  { pool: 'daily', name: 'whateat', src: 'assets/webm/是啊，吃什么.webm' },
  { pool: 'daily', name: 'butterfly', src: 'assets/webm/蝴蝶蜜蜂环绕头顶开花.webm' },
  { pool: 'daily', name: 'animals', src: 'assets/webm/动物环绕.webm' },
  { pool: 'daily', name: 'ghost', src: 'assets/webm/萌化小幽灵.webm' },
  { pool: 'daily', name: 'curtsy', src: 'assets/webm/女仆屈膝礼仪.webm' },
  { pool: 'daily', name: 'jumpcatch', src: 'assets/webm/原地跳跃抓碎头顶物品.webm' },
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
  // guess/daily 池只是被「猜动作」「日常动画」点播的特效/反应片：切出来供按名播即可，不量包围盒、不进 bodyBox——
  // 否则那些张开双臂/大伸展/放烟花的大框会把宠物全局锚点撑歪，日常姿态跟着跑偏。
  if (p.pool === 'guess' || p.pool === 'daily') {
    console.log(`${p.pool}/${p.name}  ← ${p.src.split('/').pop()}  ${(bytes / 1024).toFixed(0)} KB  （不计 bodyBox）`);
    continue;
  }
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
// 只体检核心姿态片：guess 特效片不参与 bodyBox，逐一 ffmpeg 解码 20 条既慢又只产噪音。
for (const f of listClips(skinDir)) {
  const rel = f.slice(skinDir.length + 1);
  if (rel.split(/[\\/]/).includes('guess') || rel.split(/[\\/]/).includes('daily')) continue;
  const r = analyzeFile(f, bodyBox);
  console.log(`体检 ${rel}：${JSON.stringify(r)}`);
}

console.log(`启动：PET_USER_DATA="${userData}" npx electron .`);
