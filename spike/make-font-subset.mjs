// 一次性实验（spike）：从 src 抠真实字符表 → 子集化思源黑体 → 量出静态单字重的真实体积。
// 报告里「静态子集体积未实测」那个缺口由这个脚本补。跑法：
//   node spike/make-font-subset.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const OUT_DIR = path.join(ROOT, "spike", "out");

/** 逐字符状态机：剥掉 // 行注释与 /* *\/ 块注释，再只取引号内的内容。 */
function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** 引号配对扫描：跳过转义，跨行模板串也吃进来。 */
function literals(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  const QUOTES = ['"', "'", "`"];
  while (i < n) {
    const c = text[i];
    if (QUOTES.includes(c)) {
      i++;
      const start = i;
      while (i < n && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
      out += text.slice(start, i);
      i++;
    } else i++;
  }
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|css|html)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = walk(SRC);
let code = "";
let raw = "";
for (const f of files) {
  const t = fs.readFileSync(f, "utf8");
  raw += t;
  code += literals(stripComments(t));
}

const isHan = (ch) => ch.codePointAt(0) >= 0x4e00 && ch.codePointAt(0) <= 0x9fff;
const ui = [...new Set([...code].filter(isHan))];
const inCommentsOnly = [...new Set([...raw].filter(isHan))].filter((c) => !code.includes(c));
const symbols = [...new Set(code.match(/[^\x00-\x7f]/g) || [])].filter((c) => !isHan(c));

// 自检①：界面里确定要显示的几个词，一个字都不许漏
const MUST = ["昵称", "经验", "亲密", "饥饿", "心情", "宠物档案", "正在吃饭", "打招呼", "在线时间", "等级"];
const missingFromMust = MUST.join("").split("").filter((c) => isHan(c) && !ui.includes(c));
// 自检②（反向对照）：注释专属字表应当非空，否则说明剥离没生效
console.log(`源文件 ${files.length} 个 | 字符串字面量汉字 ${ui.length} | 注释专属汉字 ${inCommentsOnly.length}（反向对照：必须 > 0）`);
console.log(`必须出现的词全命中：${missingFromMust.length === 0 ? "✅" : "❌ 缺 " + missingFromMust.join("")}`);
console.log("注释专属（抽样 40 字，这些不该进白名单）：", inCommentsOnly.slice(0, 40).join(""));
console.log("非汉字符号：", symbols.join(" "));

const text = ui.join("") + symbols.join("") + "0123456789" + "abcdefghijklmnopqrstuvwxyz" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
console.log(`\n子集码点合计 ${new Set(text).size}（汉字 ${ui.length} + 符号 ${symbols.length} + 拉丁数字）`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "glyph-set.json"), JSON.stringify({ chars: text, han: ui.length }, null, 2));

const weights = [["regular", "SourceHanSansSC-Regular.otf"], ["medium", "SourceHanSansSC-Medium.otf"]];
const TMP = "E:/ai-pet/pet-font-research/_tmp/";
for (const [name, file] of weights) {
  const src = fs.readFileSync(TMP + file);
  const t0 = Date.now();
  const woff2 = await subsetFont(src, text, { targetFormat: "woff2" });
  fs.writeFileSync(path.join(OUT_DIR, `source-han-sc-${name}.woff2`), woff2);
  console.log(`${name}: 原文件 ${(src.length / 1048576).toFixed(2)} MB → woff2 ${woff2.length} B (${(woff2.length / 1024).toFixed(1)} KB)，耗时 ${Date.now() - t0} ms`);
}

