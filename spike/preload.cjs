const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spike', {
  grab: (on) => ipcRenderer.send('spike:grab', on),
  note: (msg) => ipcRenderer.send('spike:renderer', msg),
  onCursor: (cb) => ipcRenderer.on('spike:cursor', (_e, p) => cb(p)),
})
