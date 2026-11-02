import { CANVAS_H, CANVAS_W } from '../shared/config.js'

/**
 * 渲染层空壳。这条 import 不是凑数：页面走的是自定义协议，Chromium 若不肯在
 * `app://` 下解析 ES 模块，脚本就不会执行到这里——所以它同时是协议的冒烟测试。
 * 画宠物是第 10 节的事。
 */
console.log(`[renderer] app:// 页面已加载，画布 ${CANVAS_W}x${CANVAS_H}`)
