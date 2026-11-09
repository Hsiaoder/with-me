// spike：确认 data: URI 内嵌的字体到底加载没有（别拿没加载的页面量半天）。
import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const app = await electron.launch({
  args: [path.join(ROOT, "spike", "font-compare-main.cjs")],
  cwd: ROOT,
  env: { ...process.env, FONT_COMPARE_HTML: path.join(ROOT, "spike", "out", "font-compare.html") },
});
const win = await app.firstWindow();
await win.goto("file:///" + path.join(ROOT, "spike", "out", "font-compare.html").replace(/\\/g, "/"));
await win.waitForTimeout(600);
const r = await win.evaluate(async () => {
  await document.fonts.ready;
  const loaded = [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`);
  const probe = (fam, weight = 400) => {
    const s = document.createElement("span");
    s.textContent = "饥饿：62 经验：还差 22";
    s.style.cssText = `position:absolute;left:-9999px;font-size:12px;font-weight:${weight};font-family:${fam}`;
    document.body.append(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return w;
  };
  return {
    loaded,
    checkSH: document.fonts.check("12px SH"),
    checkSH500: document.fonts.check("500 12px SH"),
    checkFR: document.fonts.check("12px FR"),
    wYahei: probe("'Microsoft YaHei UI'"),
    wSH: probe("'SH'", 400),
    wSH500: probe("'SH'", 500),
    wSH600: probe("'SH'", 600),
    wNotExist: probe("'ZZZ_NoSuch_Font'"),
  };
});
console.log(JSON.stringify(r, null, 1));
await app.close();
