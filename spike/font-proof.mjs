// spike：证死「SH 子集到底有没有被用上」。本机默认回退就是思源系，所以只能拿雅黑当对照。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "spike", "out");

const woff2 = fs.readFileSync(path.join(OUT, "source-han-sc-regular.woff2")).toString("base64");
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:'SH';src:url(data:font/woff2;base64,${woff2}) format('woff2');}
</style><body>x</body>`;
fs.writeFileSync(path.join(OUT, "font-proof.html"), html);

const app = await electron.launch({
  args: [path.join(ROOT, "spike", "font-compare-main.cjs")],
  cwd: ROOT,
  env: { ...process.env, FONT_COMPARE_HTML: path.join(OUT, "font-proof.html") },
});
const win = await app.firstWindow();
await win.goto("file:///" + path.join(OUT, "font-proof.html").replace(/\\/g, "/"));
await win.evaluate(() => {
  const rows = [
    ["yahei", "'Microsoft YaHei UI'", "饥饿：62 经验：还差 22"],
    ["sh", "'SH'", "饥饿：62 经验：还差 22"],
    ["sh-fallback", "'SH','Microsoft YaHei UI'", "饥饿：62 经验：还差 22"],
    ["sh-rare", "'SH'", "张䶮之"],
    ["sh-rare-fb", "'SH','Microsoft YaHei UI'", "张䶮之"],
  ];
  rows.forEach(([id, fam, text], i) => {
    const d = document.createElement("div");
    d.id = id;
    d.textContent = text;
    d.style.cssText = `font:40px ${fam};position:fixed;left:0;top:${i * 60}px;background:#fff;color:#000;padding:4px`;
    document.body.append(d);
  });
});
await win.evaluate(() => document.fonts.ready);
const out = {};
for (const id of ["yahei", "sh", "sh-fallback", "sh-rare", "sh-rare-fb"]) {
  const buf = await win.locator(`#${id}`).screenshot();
  fs.writeFileSync(path.join(OUT, `proof-${id}.png`), buf);
  out[id] = buf.length;
}
console.log("字节数:", JSON.stringify(out));
const eq = (a, b) => fs.readFileSync(path.join(OUT, `proof-${a}.png`)).equals(fs.readFileSync(path.join(OUT, `proof-${b}.png`)));
console.log(`sh vs yahei: ${eq("sh", "yahei") ? "❌ 完全相同 → SH 没被用上，之前所有对照都是雅黑" : "✅ 不同 → SH 真的被用上了"}`);
console.log(`sh-rare（子集里没有䶮）vs sh-rare-fb（带雅黑兜底）: ${eq("sh-rare", "sh-rare-fb") ? "相同（䶮 两处都落到同一个回退）" : "不同 → 兜底链确实在按码位逐字回退"}`);
await app.close();
