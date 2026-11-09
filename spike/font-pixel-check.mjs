// spike：用像素哈希判定字体是否真的生效（宽度对 CJK 不灵：所有中文字体汉字步进都是 1em）。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "spike", "out");

const woff2 = fs.readFileSync(path.join(OUT, "source-han-sc-regular.woff2")).toString("base64");
const ttf = fs.readFileSync(path.join(OUT, "probe-subset.ttf")).toString("base64");
const fredoka = fs.readFileSync("E:/ai-pet/pet-font-research/_tmp/Fredoka.ttf").toString("base64");
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:'W';src:url(data:font/woff2;base64,${woff2}) format('woff2');}
@font-face{font-family:'T';src:url(data:font/ttf;base64,${ttf}) format('truetype');}
@font-face{font-family:'FR';src:url(data:font/ttf;base64,${fredoka}) format('truetype');}
</style><body>x</body>`;
fs.writeFileSync(path.join(OUT, "font-format-check.html"), html);

const app = await electron.launch({
  args: [path.join(ROOT, "spike", "font-compare-main.cjs")],
  cwd: ROOT,
  env: { ...process.env, FONT_COMPARE_HTML: path.join(OUT, "font-format-check.html") },
});
const win = await app.firstWindow();
await win.goto("file:///" + path.join(OUT, "font-format-check.html").replace(/\\/g, "/"));
// canvas 的 g.font 不触发 webfont 加载（实测三个 face 一直 unloaded），必须用 DOM 文本。
const families = [["W", "饥饿经验还差"], ["T", "饥饿经验还差"], ["FR", "12345678"], ["ZZZ_NoSuch", "12345678"]];
await win.evaluate((fams) => {
  fams.forEach(([fam, text], i) => {
    const d = document.createElement("div");
    d.id = `s-${fam}`;
    d.textContent = text;
    // 各自错开纵向位置：叠在一起的话元素截图会把上层字体的像素也拍进去
    d.style.cssText = `font:48px '${fam}';position:fixed;left:0;top:${i * 80}px;background:#fff;color:#000;padding:6px`;
    document.body.append(d);
  });
}, families);
await win.evaluate(() => document.fonts.ready);
await win.waitForTimeout(300);
const statuses = await win.evaluate(() => [...document.fonts].map((f) => `${f.family}:${f.status}`));
const shots = {};
for (const [fam] of families) {
  const buf = await win.locator(`#s-${fam}`).screenshot();
  fs.writeFileSync(path.join(OUT, `face-${fam}.png`), buf);
  shots[fam] = buf.length;
}
console.log("statuses:", statuses.join(" | "));
console.log("元素截图字节数:", JSON.stringify(shots));
const same = (a, b) => fs.readFileSync(path.join(OUT, a)).equals(fs.readFileSync(path.join(OUT, b)));
console.log(`FR vs ZZZ_NoSuch（拉丁，本机没装 Fredoka）: ${same("face-FR.png", "face-ZZZ_NoSuch.png") ? "❌ 字节完全相同 → 内嵌没生效" : "✅ 不同 → data: URI 内嵌在 DOM 里是通的"}`);
console.log(`W vs T（同一子集两种容器格式）: ${same("face-W.png", "face-T.png") ? "字节相同（woff2/ttf 渲染一致）" : "字节不同（其中一种没生效！）"}`);
await app.close();
await app.close();
