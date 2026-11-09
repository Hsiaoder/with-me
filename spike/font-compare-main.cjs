// spike 用：给 font-compare.mjs 开的独立对照窗，不是产品入口。
const { app, BrowserWindow } = require("electron");
app.commandLine.appendSwitch("no-sandbox");
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    title: "字体对照（spike，用完即弃）",
    webPreferences: { offscreen: false },
  });
  win.loadFile(process.env.FONT_COMPARE_HTML);
});
