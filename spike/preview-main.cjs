/**
 * 预览用的最小 Electron 主脚本：只开一扇窗，加载命令行里给的那个地址。
 * 存在的理由：Playwright 的独立 chromium 没装，而仓库里已经有 Electron——
 * 它就是同一个渲染引擎，没必要为了看五枚图标再下载一份浏览器。
 * 跑法：npx electron spike/preview-main.cjs <url>
 */
const { app, BrowserWindow } = require('electron')

// 地址走环境变量：Electron 的 argv 下标会随启动方式变（打包、cli 包装、playwright 传参各不同），
// 拿它当参数接口迟早静默变成「加载了 about:blank 然后截一张白图」。
const url = process.env.PREVIEW_URL

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 580,
    height: 480,
    show: false,
    webPreferences: { offscreen: false },
  })
  if (!url) {
    console.error('[preview] 没给 PREVIEW_URL，argv=' + JSON.stringify(process.argv))
    return
  }
  win.loadURL(url)
})
