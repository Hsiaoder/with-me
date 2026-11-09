// 一次性实验（spike）：把「思源子集 vs 现在的微软雅黑」摆同一屏，12px 真字号真缩放开一个窗口给他看。
// 不改产品代码、不进 dist、不碰协议白名单——字体全部以 data: URI 内嵌在这个独立页面里。
// 跑法：node spike/font-compare.mjs [--shot 路径]（--shot 会顺手存一张 PNG 供本机像素复核）
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "spike", "out");
const TMP = "E:/ai-pet/pet-font-research/_tmp/";

const b64 = (p) => fs.readFileSync(p).toString("base64");
const regular = b64(path.join(OUT, "source-han-sc-regular.woff2"));
const medium = b64(path.join(OUT, "source-han-sc-medium.woff2"));
const fredoka = b64(TMP + "Fredoka.ttf");

const rows = [
  ["昵称：鲸鲸", "性别：♀"],
  ["等级：Lv.2", "经验：还差 22"],
  ["饥饿：62", "心情：78"],
  ["亲密：15", "状态：正在吃饭"],
  ["在线时间：2分5秒", "宠物档案"],
];
const bubble = "你好呀，今天也一起在桌面上待着吧，饿了就喂我一口。";
const rare = "昵称：张䶮之";

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'SH';src:url(data:font/woff2;base64,${regular}) format('woff2');font-weight:400;}
@font-face{font-family:'SH';src:url(data:font/woff2;base64,${medium}) format('woff2');font-weight:500;}
@font-face{font-family:'FR';src:url(data:font/ttf;base64,${fredoka}) format('truetype');}
:root{--ink:#2b2f36;--panel:rgba(255,255,255,.86);}
*{box-sizing:border-box;margin:0}
body{background:#c9d8e6;font-family:'Microsoft YaHei UI',sans-serif;color:var(--ink);padding:18px}
h2{font-size:13px;font-weight:600;margin:18px 0 8px;color:#1b3a52}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.card{background:var(--panel);border-radius:10px;padding:10px 12px;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.card b{display:block;font-size:11px;font-weight:400;color:#5b6b7a;margin-bottom:6px}
.line{font-size:12px;line-height:17px;display:flex;justify-content:space-between;gap:12px}
.yahei{font-family:'Microsoft YaHei UI',sans-serif}
.sh{font-family:'SH','Microsoft YaHei UI',sans-serif}
.shmix{font-family:'SH','Microsoft YaHei UI',sans-serif}
.shmed{font-family:'SH','Microsoft YaHei UI',sans-serif}
.yahei .line,.yahei div{font-weight:400}
.sh .line,.sh div{font-weight:400}
.shmix .line,.shmix div{font-weight:600}
.shmed .line,.shmed div{font-weight:500}
.bubble{margin-top:8px;font-size:12px;line-height:18px;max-width:300px}
.digits{font-size:12px;line-height:17px;margin-top:4px}
.fr .digits{font-family:'FR','SH',sans-serif}
.rare{font-size:12px;margin-top:6px}
</style></head><body>
<h2>⓪ 字号阶梯（远程拉伸下，字号可能比字体更要紧）：12 / 13 / 14 / 16 / 18px</h2>
<div class="grid" id="ladder">
  <div class="card yahei"><b>Microsoft YaHei UI</b>${[12, 13, 14, 16, 18].map((s) => `<div style="font-size:${s}px;line-height:${s + 5}px">饥饿：62 经验：还差 22</div>`).join("")}</div>
  <div class="card sh"><b>思源 400 子集</b>${[12, 13, 14, 16, 18].map((s) => `<div style="font-size:${s}px;line-height:${s + 5}px">饥饿：62 经验：还差 22</div>`).join("")}</div>
  <div class="card shmed"><b>思源 Medium 子集</b>${[12, 13, 14, 16, 18].map((s) => `<div style="font-size:${s}px;line-height:${s + 5}px">饥饿：62 经验：还差 22</div>`).join("")}</div>
</div>
<h2>① 状态栏 12px：雅黑（现状） / 思源 Regular 子集 / 思源 Regular + font-weight:600（合成加粗） / 思源 Medium</h2>
<div class="grid">
  <div class="card yahei"><b>Microsoft YaHei UI 400（现状）</b>${rows.map((r) => `<div class="line"><span>${r[0]}</span><span>${r[1]}</span></div>`).join("")}</div>
  <div class="card sh"><b>思源 400 子集</b>${rows.map((r) => `<div class="line"><span>${r[0]}</span><span>${r[1]}</span></div>`).join("")}</div>
  <div class="card shmix"><b>思源 400 子集 + 600（合成加粗，不发 Medium 就是它）</b>${rows.map((r) => `<div class="line"><span>${r[0]}</span><span>${r[1]}</span></div>`).join("")}</div>
  <div class="card shmed"><b>思源 Medium 子集（真 500）</b>${rows.map((r) => `<div class="line"><span>${r[0]}</span><span>${r[1]}</span></div>`).join("")}</div>
</div>
<h2>② 气泡正文 24 字 12px（同一张卡上下两行：上雅黑 / 下思源）</h2>
<div class="card" style="max-width:340px">
  <div class="bubble" style="font-family:'Microsoft YaHei UI'">${bubble}</div>
  <div class="bubble" style="font-family:'SH','Microsoft YaHei UI';border-top:1px dashed #9ab;margin-top:6px;padding-top:6px">${bubble}</div>
</div>
<h2>③ 数字/拉丁：思源自带 vs Fredoka 12px 与 14px</h2>
<div class="grid">
  <div class="card"><b>思源数字</b><div class="digits">Lv.2 · +14 · 0/22 · 2分5秒 · 62% · 1234567890</div></div>
  <div class="card fr"><b>Fredoka + 思源（栈首是 Fredoka）</b><div class="digits">Lv.2 · +14 · 0/22 · 2分5秒 · 62% · 1234567890</div></div>
  <div class="card fr"><b>Fredoka 14px</b><div class="digits" style="font-size:14px">Lv.12 +14 62%</div></div>
</div>
<h2>④ 缺字兜底（子集里没有「䶮」，应落回雅黑而不是豆腐块）</h2>
<div class="card sh" style="max-width:340px"><div class="rare">${rare} · 这条用的是「SH → 雅黑」回退链</div></div>
</body></html>`;

const htmlPath = path.join(OUT, "font-compare.html");
fs.writeFileSync(htmlPath, page);

const app = await electron.launch({
  args: [path.join(ROOT, "spike", "font-compare-main.cjs")],
  cwd: ROOT,
  env: { ...process.env, FONT_COMPARE_HTML: htmlPath },
});
const win = await app.firstWindow();
// 不要调 setViewportSize：它会把 deviceScaleFactor 重置成 1，量到的 DPR 就废了（本次踩过一次）。
await win.goto("file:///" + htmlPath.replace(/\\/g, "/"));
await win.waitForTimeout(400);
const shotIdx = process.argv.indexOf("--shot");
if (shotIdx >= 0) {
  const buf = await win.screenshot({ path: process.argv[shotIdx + 1] });
  console.log("已存整页截图", process.argv[shotIdx + 1], buf.length, "B");
}
// 元素级截图：clip 在这个页面上会报「区域在图外」，直接按选择器取卡片，出来就是原生 2× 像素。
const onlyIdx = process.argv.indexOf("--only");
if (onlyIdx >= 0) {
  const buf = await win.locator(process.argv[onlyIdx + 1]).first().screenshot();
  const saveIdx = process.argv.indexOf("--save");
  const p = saveIdx >= 0 ? path.resolve(process.argv[saveIdx + 1]) : path.join(OUT, "crop.png");
  fs.writeFileSync(p, buf);
  console.log("已存元素截图", p, buf.length, "B");
}
console.log("devicePixelRatio =", await win.evaluate(() => devicePixelRatio));
if (process.argv.includes("--quit")) {
  await app.close();
  process.exit(0);
}
console.log("窗口已打开。看完关窗口即可，产品代码没动。");
await new Promise(() => {});
