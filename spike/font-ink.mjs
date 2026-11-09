// spike：把三张 2× 元素截图的墨迹量出来，别只靠眼看。
// 指标：① 该行墨迹高度（最上/最下有墨的行的差）② 竖直笔画宽度（连续暗像素 run 的中位数）③ 覆盖率。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png-decode.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const files = [["雅黑 400", "ladder-1.png"], ["思源 400 子集", "ladder-2.png"], ["思源 Medium 子集", "ladder-3.png"]];

/** 取第 bandIdx 条墨带（0 是卡片标题，1 起是 12/13/14/16/18px 五行）。 */
function analyze(img, label, bandIdx = 1) {
  const { W, H, ch, px } = img;
  const lum = (x, y) => {
    const o = (y * W + x) * ch;
    return 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
  };
  // 背景是浅色卡面，暗于 150 视为有墨
  const rows = [];
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = 0; x < W; x++) if (lum(x, y) < 150) c++;
    rows.push(c);
  }
  // 跳过标题行（第一个墨带），取第二个墨带 = 12px 那行
  const bands = [];
  let inBand = false;
  for (let y = 0; y < H; y++) {
    if (rows[y] > 3 && !inBand) { inBand = true; bands.push({ y0: y }); }
    else if (rows[y] <= 3 && inBand) { inBand = false; bands[bands.length - 1].y1 = y - 1; }
  }
  const b = bands[bandIdx];
  if (!b) return console.log(`${label}: 没找到第 ${bandIdx} 条墨带（共 ${bands.length} 个）`);
  const inkH = b.y1 - b.y0 + 1;
  let ink = 0;
  let mass = 0;
  const runs = [];
  for (let y = b.y0; y <= b.y1; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      const v = lum(x, y);
      const dark = v < 150;
      if (dark) { run++; ink++; } else if (run) { runs.push(run); run = 0; }
      // 墨迹质量：连 150~235 的浅灰边一起算，这才是 Medium/Regular 真正拉开的地方
      if (v < 235) mass += (255 - v) / 255;
    }
    if (run) runs.push(run);
  }
  runs.sort((a, c) => a - c);
  const med = runs[Math.floor(runs.length / 2)];
  const area = (b.y1 - b.y0 + 1) * W;
  console.log(
    `${label.padEnd(24)} 墨迹高 ${inkH} 设备px（=${(inkH / 2).toFixed(1)} CSS px）| ` +
    `暗像素 run 中位数 ${med}（=${(med / 2).toFixed(1)} CSS px）| 硬覆盖率 ${(100 * ink / area).toFixed(3)}% | ` +
    `墨迹质量 ${(100 * mass / area).toFixed(3)}%`,
  );
  return { b, W, ch, px, lum };
}

const imgs = files.map(([label, f]) => ({ label: `${label} 12px`, ...analyze(decodePng(fs.readFileSync(path.join(OUT, f))), `${label} 12px`) }));

// 反向对照：三张卡的 12px 带必须真的不一样。上一版 CSS 把字体挂在 .line 上，
// 阶梯行是裸 div 没命中，结果三张全是雅黑、指标一模一样——所以这一步是自检，不是装饰。
for (let i = 0; i < imgs.length; i++) {
  for (let j = i + 1; j < imgs.length; j++) {
    const a = imgs[i], c = imgs[j];
    if (!a.b || !c.b) continue;
    const y0 = Math.min(a.b.y0, c.b.y0), y1 = Math.max(a.b.y1, c.b.y1);
    let n = 0, maxd = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < Math.min(a.W, c.W); x++) {
        const oa = (y * a.W + x) * a.ch, oc = (y * c.W + x) * c.ch;
        const d = Math.max(
          Math.abs(a.px[oa] - c.px[oc]),
          Math.abs(a.px[oa + 1] - c.px[oc + 1]),
          Math.abs(a.px[oa + 2] - c.px[oc + 2]),
        );
        if (d > 8) n++;
        if (d > maxd) maxd = d;
      }
    }
    console.log(`12px 带差异 ${a.label} vs ${c.label}: 明显不同的像素 ${n} 个，最大通道差 ${maxd}${n === 0 ? "  ← 两张一样，字体没生效！" : ""}`);
  }
}

// 字号阶梯：同一张雅黑卡上 12→18px，用来判断「加一号字」和「换字体/换字重」哪个杠杆更大。
console.log("\n字号阶梯（同一张雅黑卡，墨带 1..5 = 12/13/14/16/18px）：");
const ladderImg = decodePng(fs.readFileSync(path.join(OUT, "ladder-1.png")));
[12, 13, 14, 16, 18].forEach((s, i) => analyze(ladderImg, `雅黑 ${s}px`, i + 1));
