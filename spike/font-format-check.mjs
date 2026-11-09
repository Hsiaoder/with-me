// spike：同一子集的 woff2 与 ttf 同页对拍，定位「加载成功但字形不生效」出在哪一步。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "spike", "out");

const woff2 = fs.readFileSync(path.join(OUT, "source-han-sc-regular.woff2")).toString("base64");
const ttf = fs.readFileSync(path.join(OUT, "probe-subset.ttf")).toString("base64");

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:'W';src:url(data:font/woff2;base64,${woff2}) format('woff2');}
@font-face{font-family:'T';src:url(data:font/ttf;base64,${ttf}) format('truetype');}
</style><body>x</body>`;
fs.writeFileSync(path.join(OUT, "font-format-check.html"), html);

const app = await electron.launch({
  args: [path.join(ROOT, "spike", "font-compare-main.cjs")],
  cwd: ROOT,
  env: { ...process.env, FONT_COMPARE_HTML: path.join(OUT, "font-format-check.html") },
});
const win = await app.firstWindow();
await win.goto("file:///" + path.join(OUT, "font-format-check.html").replace(/\\/g, "/"));
const r = await win.evaluate(async () => {
  await document.fonts.ready;
  const probe = (fam) => {
    const s = document.createElement("span");
    s.textContent = "饥饿：62 经验：还差 22";
    s.style.cssText = `position:absolute;left:-9999px;font-size:40px;font-family:${fam}`;
    document.body.append(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return w;
  };
  return {
    statuses: [...document.fonts].map((f) => `${f.family}:${f.status}`),
    W: probe("'W'"),
    T: probe("'T'"),
    YaHei: probe("'Microsoft YaHei UI'"),
    ZZZ: probe("'ZZZ_NoSuch'"),
  };
});
console.log(JSON.stringify(r, null, 1));
console.log(r.W !== r.ZZZ && r.T !== r.ZZZ ? "✅ woff2 与 ttf 都生效" :
  r.W === r.ZZZ && r.T !== r.ZZZ ? "❌ woff2 没生效，ttf 生效 → 问题在 woff2 转换/声明" :
  r.W !== r.ZZZ && r.T === r.ZZZ ? "❌ ttf 没生效" : "❌ 两者都没生效");
await app.close();
