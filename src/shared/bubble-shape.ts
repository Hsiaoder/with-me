/**
 * 云朵气泡的**形状合同**：一份图元清单，同时喂给三处——
 * ① `tools/make-bubble-svg.mjs` 用它生成 `src/renderer/emotes/bubble.svg`；
 * ② `config.ts` 从它算出显示尺寸、环厚与内容下界；
 * ③ `test/config.test.ts` 用它判断「文字和回应按钮有没有落在白色内腔里」。
 *
 * 为什么清单只有一份：上一版气泡是一条手写的 `<path>`，几何靠注释里那几个数，
 * 形状一改就得手工重算 `BUBBLE_INNER_BOTTOM`/`BUBBLE_CAVITY` 三处，
 * 而测试只能读 viewBox 和 stroke-width 两个数——中间那段是**信我算对了**，不是验出来的。
 *
 * 为什么是「图元的并集」而不是描边路径：并集的轮廓要画一圈均匀的边，
 * 用「先画放大 t 的彩色并集、再画原始白色并集」这一招就够了。
 * 这在数学上是精确的——**膨胀（与半径 t 的圆做 Minkowski 和）对并集可分配**，
 * 而圆角矩形本身就是「矩形膨胀 rx」，所以每个图元各自加 t 再并起来，
 * 就等于「整个形状并起来再加 t」。于是：
 * · 环厚处处正好 = t（不会在接缝处变粗或断掉）；
 * · 交界处不会多出横线（那是「矩形和尾巴分两条路径画」踩过的坑，见 problem/03 §3.8）。
 */

/** 一个圆（viewBox 单位） */
export type CloudCircle = { x: number; y: number; r: number }
/** 一个圆角矩形（viewBox 单位） */
export type CloudRect = { x: number; y: number; w: number; h: number; r: number }

export type CloudShape = {
  /** 画布尺寸，显示比例必须等于 BUBBLE_W/BUBBLE_H */
  vb: { w: number; h: number }
  /** 环厚（viewBox 单位）。彩色那层 = 每个图元各自外扩这么多 */
  ring: number
  /** 身子：一块圆角矩形，文字与回应按钮就落在它里面 */
  body: CloudRect
  /** 顶上的三朵云包（圆心都压在身子上沿附近，只往上鼓） */
  bumps: CloudCircle[]
  /**
   * 底边的两朵云包（圆心压在下沿上，只往下鼓）。用户 2026-11-06 要「下面也变成云朵形状」：
   * 以前只有顶上是云、底下是一条平边，读起来像「头上顶着一朵云的矩形」。
   * 分在尾巴两侧——中间那格留给尾巴，不然云团会把尾巴根挤掉。
   */
  foots: CloudCircle[]
  /** 尾巴：三颗越往下越小的云团，指向宠物。不是一根尖——云朵气泡的尾巴也该是云 */
  tail: CloudCircle[]
}

/**
 * 画布 = **含环的墨迹包围盒**（416×376 单位 → 显示 208×188，比例 0.5）。
 * 为什么要贴到墨迹而不是留一圈空白：气泡的矩形框是锚点算出来的（`bubbleAnchor` 拿
 * BUBBLE_W/H 定位、和宠物保持 BUBBLE_GAP），框里要是空着一圈，那段空白也照样占位——
 * 于是「离宠物 12px」实际变成 12 + 空白。上一版 path 版是把轮廓正好画满画布的，这版保持同样约定。
 *
 * 数字（单位；CSS 值 = ×0.5）：
 * · 身子 x 12..404、y 108..318，圆角 62 → CSS 6..202 × 54..159，文字与回应按钮就落在这块里；
 * · 三朵云包顶到 y 12（含环 0），中间那朵最高（r 86、圆心还往上抬了 10）；
 * · 底边两朵云包 r 36/38（比顶上那三朵小一档：云的下缘通常更碎），底到 356；
 * · 尾巴三颗越往下越小（28 → 16 → 8），尖那颗底到 364、含环 376 = 画布下沿，正好不空也不裁。
 *   **它必须仍是最低的那一个**：底边的云包要是鼓得比尾巴还低，尾巴就不指着宠物了，只是两条曲线；
 * · 尾巴整体偏中间一点（尖在 x 200，身子中线 208）——它得指着宠物，不是指着左下角。
 *   以前那版是一根三角尖，这版换成三颗渐小的云团：云朵气泡的尾巴也该是云。
 * · 内容块（文字 60 + 缝 4 + 按钮 22 = 86 高、150 宽）落在 CSS x 29..179、y 57..143，
 *   离最近的白边还有 12 单位（6 CSS px），四角与四条边的中点都验过（见 fitsInsideCloud）。
 */
export const CLOUD: CloudShape = {
  vb: { w: 416, h: 376 },
  ring: 12,
  body: { x: 12, y: 108, w: 392, h: 210, r: 62 },
  bumps: [
    { x: 108, y: 108, r: 68 },
    { x: 208, y: 98, r: 86 },
    { x: 313, y: 108, r: 66 },
  ],
  foots: [
    { x: 84, y: 318, r: 36 },
    { x: 322, y: 318, r: 38 },
  ],
  tail: [
    { x: 218, y: 310, r: 28 },
    { x: 208, y: 338, r: 16 },
    { x: 200, y: 356, r: 8 },
  ],
}

/** 并集里所有圆（顶上云包 + 底边云包 + 尾巴；身子四角的圆弧由 rect 单独判，见 insideCloud）。 */
export const cloudCircles = (s: CloudShape): CloudCircle[] => [...s.bumps, ...s.foots, ...s.tail]

/** 一个点在不在**白色内腔**里（viewBox 单位，未加环）。 */
export function insideCloud(s: CloudShape, x: number, y: number): boolean {
  for (const c of cloudCircles(s)) {
    if (Math.hypot(x - c.x, y - c.y) <= c.r) return true
  }
  const b = s.body
  if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) return false
  // 圆角矩形 = 中间那块十字 + 四个 1/4 圆
  const cx = x < b.x + b.r ? b.x + b.r : x > b.x + b.w - b.r ? b.x + b.w - b.r : null
  const cy = y < b.y + b.r ? b.y + b.r : y > b.y + b.h - b.r ? b.y + b.h - b.r : null
  if (cx === null || cy === null) return true
  return Math.hypot(x - cx, y - cy) <= b.r
}

/**
 * 内容块落在内腔里、而且离白边够远吗。
 *
 * 「够远」按**内缩后的形状**判：把每个图元都收进 `pad` 单位，块的四角与四条边的中点
 * 都得落在这个收缩版里。只看四角是不够的——云包之间的凹缝正好能从边的中段咬进来一口。
 */
export function fitsInsideCloud(
  s: CloudShape,
  box: { x: number; y: number; w: number; h: number },
  pad: number,
): boolean {
  const shrunk: CloudShape = {
    ...s,
    body: {
      x: s.body.x + pad,
      y: s.body.y + pad,
      w: s.body.w - pad * 2,
      h: s.body.h - pad * 2,
      r: Math.max(0, s.body.r - pad),
    },
    bumps: s.bumps.map((c) => ({ x: c.x, y: c.y, r: c.r - pad })),
    foots: s.foots.map((c) => ({ x: c.x, y: c.y, r: c.r - pad })),
    tail: s.tail.map((c) => ({ x: c.x, y: c.y, r: c.r - pad })),
  }
  const pts: [number, number][] = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
    [box.x + box.w / 2, box.y],
    [box.x + box.w / 2, box.y + box.h],
    [box.x, box.y + box.h / 2],
    [box.x + box.w, box.y + box.h / 2],
  ]
  return pts.every(([x, y]) => insideCloud(shrunk, x, y))
}

/** viewBox 单位 → CSS 像素的比例（宽高等比，所以一个数就够）。 */
export const cloudScale = (s: CloudShape, cssW: number): number => cssW / s.vb.w
