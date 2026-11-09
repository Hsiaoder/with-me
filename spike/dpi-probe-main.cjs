// spike 用：把主进程读到的 screen 度量塞进 window，供 dpi-probe.mjs 对照。
const { app, BrowserWindow, screen } = require("electron");
app.commandLine.appendSwitch("no-sandbox");
app.whenReady().then(() => {
  const d = screen.getPrimaryDisplay();
  const payload = JSON.stringify({
    scaleFactor: d.scaleFactor,
    bounds: d.bounds,
    workArea: d.workArea,
    size: d.size,
    colorDepth: d.colorDepth,
  });
  const win = new BrowserWindow({ width: 400, height: 200, show: false, webPreferences: { contextIsolation: false } });
  win.loadURL("data:text/html,<title>dpi</title>");
  win.webContents.once("did-finish-load", () => {
    win.executeJavaScript(`window.__electronScreen = ${payload}`);
  });
});
