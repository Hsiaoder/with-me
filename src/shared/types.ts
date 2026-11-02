/** 几何与坐标类型。坐标一律是「所在层的本地坐标」，跨层换算只在 geometry.ts 做。 */

export type Point = { x: number; y: number }

/** 矩形。x/y 是左上角，w/h 是宽高，单位由调用方注明（画布像素或覆盖层 CSS 像素）。 */
export type Rect = { x: number; y: number; w: number; h: number }

/** 画布坐标下的矩形，语义上是「身体占的位置」。与 Rect 同构，但单位不同，故单列类型名。 */
export type Box = Rect

export type Facing = 'left' | 'right'

/** 皮肤的动画池名。必需池见 config.ts 的 REQUIRED_POOLS，皮肤可另外加自定义池。 */
export type PoolName = string

/** 一条动画的定位：池名 + 动画名。动画名就是文件名，禁止用数组下标寻址。 */
export type ClipRef = { pool: PoolName; name: string }
