const { contextBridge, ipcRenderer } = require('electron')

/**
 * 预加载脚本：暴露给渲染层的白名单，只有这几个动作。
 * 通道名字符串是就地内联的（preload 在沙箱里不能 import 业务模块），
 * 由 test/preload-contract.test.ts 核对它与 src/shared/ipc.ts 一致。
 */
contextBridge.exposeInMainWorld('petBridge', {
  /** 主进程每 33ms 推进来的光标位置（覆盖层内坐标）。穿透状态下这是唯一的鼠标信息来源。 */
  onCursor: (cb) => ipcRenderer.on('pet:cursor', (_e, p) => cb(p)),
  /** 主进程校验完皮肤后送进来的数据，或一串错误。 */
  onSkin: (cb) => ipcRenderer.on('pet:skin-loaded', (_e, s) => cb(s)),
  /** 请求接住鼠标（true）或恢复穿透（false）。调用方必须每帧续期，否则主进程超时自动放开。 */
  requestGrab: (grab) => ipcRenderer.send('pet:click-through', { grab }),
  /** 可见性设置。主进程收到后立刻落盘并按新值重新判断该不该显示。 */
  setSettings: (s) => ipcRenderer.send('pet:settings', s),
  /** 开局把存档里的可见性设置推过来，面板的选中态要用它。 */
  onSettings: (cb) => ipcRenderer.on('pet:settings-loaded', (_e, s) => cb(s)),
  /** 上报一次养成动作（喂 / 玩 / 回应 / 开面板）。算多少由主进程说了算。 */
  statEvent: (e) => ipcRenderer.send('pet:stats-event', e),
  /** 调试面板直接设数值 / 经验。主进程收敛校验后写进真存档并广播。 */
  debugStats: (patch) => ipcRenderer.send('pet:stats-debug', patch),
  /** 改名与改性别。 */
  setIdentity: (patch) => ipcRenderer.send('pet:identity', patch),
  /** 开局推一次数值快照，之后每次 tick 或动作都会再推一次。 */
  onStats: (cb) => ipcRenderer.on('pet:stats-loaded', (_e, s) => cb(s)),
  /** 用户点了「退出桌宠」：渲染层先说完 bye，再走这条让主进程落盘并退出。 */
  quitApp: () => ipcRenderer.send('pet:quit'),
  /** 托盘点了「退出」：先走和面板一样的告别动画/语音，演完再 quitApp 让主进程收窗。 */
  onQuitRequested: (cb) => ipcRenderer.on('pet:quit-requested', (_e) => cb()),
})
