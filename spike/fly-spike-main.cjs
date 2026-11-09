// 一次性 spike：鲸鲸会飞手感测试。
// 关键教训（上次踩过）：这是置顶窗，绝不能再开成**整屏**且吞鼠标——那会把用户锁在桌面外。
// 所以这里开一扇**有界小窗**（只在框内抓鼠标），并留一个 180s 自动退出的兜底。
const { app, BrowserWindow, screen } = require('electron')
const { join } = require('node:path')

const GW = 460, GH = 720
app.commandLine.appendSwitch('no-sandbox')
app.whenReady().then(() => {
  const wa = screen.getPrimaryDisplay().workArea
  const full = process.env.FLY_FULL === '1'
  const GW2 = full ? wa.width : GW
  const GH2 = full ? wa.height : GH
  const win = new BrowserWindow({
    width: GW2, height: GH2,
    x: full ? wa.x : wa.x + Math.round((wa.width - GW) / 2),
    y: full ? wa.y : wa.y + Math.round((wa.height - GH) / 2),
    show: false, frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true,
    ...(process.platform === 'win32' && { type: 'toolbar' }),
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false) // 只在 GW×GH 这块小窗内抓鼠标，不再全屏吞点击
  win.once('ready-to-show', () => win.showInactive())
  win.loadFile(join(__dirname, 'out', 'fly-spike.html'))

  let seen = 0
  const tick = async () => {
    try {
      const fps = await win.webContents.executeJavaScript('window.__fps || 0')
      const logs = await win.webContents.executeJavaScript('window.__log || []')
      for (; seen < logs.length; seen++) console.log('[fly]', logs[seen])
      console.log(`fps=${fps}`)
    } catch (e) { console.log('poll err', String(e)) }
  }
  const iv = setInterval(tick, 1000)
  win.on('closed', () => { clearInterval(iv); app.quit() })
  // 兜底：180 秒自己退出，免得窗口忘了关又卡住鼠标
  setTimeout(() => { console.log('auto-quit 180s'); if (!win.isDestroyed()) win.close() }, 180_000)
})
