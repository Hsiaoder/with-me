/**
 * Spike 的证据分析：纯函数，可单测。
 * 结论「有没有一块矩形底」完全由这两个函数给出，所以它们自己得先被证明是对的。
 */

/** 逐通道差值超过这个数才算「变了」，压掉桌面自身的轻微噪声。 */
export const DIFF_EPS = 8
/** alpha 超过这个数才算「不透明」。 */
export const ALPHA_EPS = 8

function toDeviceBoxes(rects, scale) {
  return rects.map((r) => ({
    x0: Math.floor(r.x * scale),
    y0: Math.floor(r.y * scale),
    x1: Math.ceil((r.x + r.w) * scale),
    y1: Math.ceil((r.y + r.h) * scale),
  }))
}

/**
 * 两张屏幕位图做差，统计变化像素、变化区外接框，以及落在预期区域之外的变化数。
 *
 * roi 把比较范围限定在覆盖层自己的舞台矩形内。不限制的话，两次截图之间
 * 桌面上任何别的应用动一下都会被算成「漏色」——实测过一次虚警，322k 像素
 * 全来自宠物框之外的其它窗口，跟覆盖层没关系。
 *
 * @param base BGRA 位图（窗口藏起来时拍的）
 * @param shot BGRA 位图（窗口显示时拍的）
 * @param size {width,height} 位图像素尺寸
 * @param scale 显示器缩放
 * @param rects CSS 像素的矩形数组（宠物框、提示框），会被换算到设备像素
 * @param {{x:number,y:number,w:number,h:number}|null} [roi] CSS 像素的比较范围，默认整屏
 */
export function diffScreens(base, shot, size, scale, rects, roi = null) {
  const { width: w, height: h } = size
  const boxes = toDeviceBoxes(rects, scale)
  const [r] = toDeviceBoxes([roi ?? { x: 0, y: 0, w: w / scale, h: h / scale }], scale)
  let changed = 0
  let outside = 0
  let scanned = 0
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = Math.max(0, r.y0); y < Math.min(h, r.y1); y++) {
    for (let x = Math.max(0, r.x0); x < Math.min(w, r.x1); x++) {
      scanned++
      const i = (y * w + x) * 4
      const d = Math.max(
        Math.abs(base[i] - shot[i]),
        Math.abs(base[i + 1] - shot[i + 1]),
        Math.abs(base[i + 2] - shot[i + 2]),
      )
      if (d <= DIFF_EPS) continue
      changed++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (!boxes.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1)) outside++
    }
  }
  return {
    width: w,
    height: h,
    roi: { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 },
    scanned,
    changed,
    outsideExpected: outside,
    bbox: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  }
}

/**
 * 统计页面合成结果的 alpha：预期区域之外必须全透明，否则就是有一块底。
 * 提示框自己是白底不透明的，所以它得算进「预期区域」，不然会被误判成漏色。
 *
 * @param bgra BGRA 位图
 * @param size {width,height}
 * @param scale 显示器缩放
 * @param rects CSS 像素的矩形数组
 */
export function alphaStats(bgra, size, scale, rects) {
  const { width: w, height: h } = size
  const boxes = toDeviceBoxes(rects, scale)
  let outsideOpaque = 0, outsideMax = 0, outsideSamples = 0
  let insideOpaque = 0, insideMax = 0, insideSamples = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = bgra[(y * w + x) * 4 + 3]
      const inRect = boxes.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1)
      if (inRect) {
        insideSamples++
        if (a > insideMax) insideMax = a
        if (a > ALPHA_EPS) insideOpaque++
      } else {
        outsideSamples++
        if (a > outsideMax) outsideMax = a
        if (a > ALPHA_EPS) outsideOpaque++
      }
    }
  }
  return { outsideSamples, outsideOpaque, outsideAlphaMax: outsideMax, insideSamples, insideOpaque, insideAlphaMax: insideMax }
}
