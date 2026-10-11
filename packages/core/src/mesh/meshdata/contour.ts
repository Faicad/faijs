/**
 * meshdata/contour — 2D 轮廓类型（three `THREE.Shape` 的自有替代）。
 *
 * 语义对应：
 * - `outer` ↔ three `Shape` 的外轮廓点集（points）
 * - `holes` ↔ three `Shape.holes`（孔洞子路径）
 * - 多条互不相交轮廓（`SVGLoader.createShapes` 返回 `Shape[]` 的情形）用 `Contour[]` 表达
 *
 * 坐标约定：**Y-up 平面坐标**（与 core 世界坐标系一致，+Z 向上、轮廓位于 XY 平面）。
 * 从 SVG（Y-down）/ opentype（Y-down）来的数据由调用方负责翻转后再交给本模块。
 */

/** 2D 平面点（轮廓顶点）。 */
export interface P2 {
  x: number
  y: number
}

/** 一条 2D 轮廓：外环 + 孔环。 */
export interface Contour {
  outer: P2[]
  holes: P2[][]
}

/**
 * Shoelace 有符号面积。Y-up 坐标系下 >0 为逆时针（CCW）。
 * @param pts - 轮廓顶点（含首尾闭环约定则自动忽略重复尾点的影响）。
 * @returns the signed area; 0 when fewer than 3 points.
 */
export function signedArea2(pts: P2[]): number {
  const n = pts.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return area / 2
}

/**
 * 反转轮廓顶点顺序（用于 winding 归一：外环转 CCW、孔环转 CW）。
 * @param pts - source points.
 * @returns a new array with reversed order.
 */
export function reverse2(pts: P2[]): P2[] {
  const out: P2[] = new Array(pts.length)
  for (let i = 0; i < pts.length; i++) out[i] = pts[pts.length - 1 - i]
  return out
}
