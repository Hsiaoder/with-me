// 列出所有 electron.exe 的 PID 与命令行，只为了分辨哪几个是 with-me 的主进程。
// 一次性排查脚本，用完可删。
import { execFile } from 'node:child_process'

const filter = "Name='electron.exe'"
const script = `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`

execFile('powershell.exe', ['-NoProfile', '-OutputFormat', 'Text', '-Command', script], (err, out, stderr) => {
  if (err) console.error('failed:', err.message, stderr)
  for (const line of out.split('\n')) {
    const t = line.trim()
    if (t) console.log(t.includes('with-me') ? `MINE ${t}` : `other ${t.slice(0, 120)}`)
  }
})
