// spike：量 Electron 眼里的 DPI 和 Windows 眼里的 DPI 是否一致。
import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const app = await electron.launch({ args: [path.join(ROOT, "spike", "dpi-probe-main.cjs")], cwd: ROOT });
const win = await app.firstWindow();
const r = await win.evaluate(() => ({
  devicePixelRatio,
  screenW: screen.width,
  screenH: screen.height,
  availW: screen.availWidth,
  dprFromMatchMedia: matchMedia(`(${devicePixelRatio}dppx)`).matches,
}));
const info = await win.evaluate(() => window.__electronScreen || null);
console.log("页面里：", JSON.stringify(r));
console.log("主进程 screen：", JSON.stringify(info));
await app.close();
