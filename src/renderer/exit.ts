/**
 * 退出只允许启动一次。面板的旧「退出」入口、托盘菜单、主进程重发的退出请求
 * 都可能先后到达；重复启动会重放告别动画、叠加兜底定时器，所以统一在这里收敛。
 */
export function createExitSequencer(start: () => void): () => void {
  let started = false
  return () => {
    if (started) return
    started = true
    start()
  }
}
