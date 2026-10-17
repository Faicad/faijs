/**
 * 2D 闭合轮廓的嵌套分组（evenodd 语义）——从 `primitives/svg/svg-path.ts`
 * 下沉到 geometry2d（2026-10-17）。
 *
 * 动机：嵌套分组是**纯 2D 几何问题**（bbox 包含 + 质心射线法 + 奇偶深度），
 * 与 SVG 无关。DXF 导入同样需要它（外轮廓圈 + 内孔圈），放在 SVG 专属目录
 * 会阻碍 DXF 复用。svg-path.ts 保留同名 re-export 以兼容既有调用方。
 * @module
 */

/** 二维点（最小结构约定，兼容任意 {x,y} 形状）。 */
export interface NestPoint {
  x: number
  y: number
}

/** 可参与嵌套分类的闭合子路径（点集版：wire 版在调用方组装句柄）。 */
export interface ClassifiableSubpath {
  points: NestPoint[]
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  signedArea: number
}

/**
 * Shoelace 有符号面积（正/负语义与坐标系朝向无关，仅比较绝对值）。
 * @param points - 闭合子路径的顶点序列（首尾不重复亦可，按环序求和）。
 * @returns 有符号面积（×0.5），点数 < 3 返回 0。
 */
export function computeSignedArea(points: NestPoint[]): number {
  const n = points.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return area / 2
}

/**
 * 射线法判断点是否在多边形内部（含边界视为内部由交点奇偶决定）。
 * @param pt - 待测点。
 * @param polygon - 多边形顶点序列（环序）。
 * @returns true 当且仅当点在多边形内部。
 */
export function pointInPolygon(pt: NestPoint, polygon: NestPoint[]): boolean {
  const n = polygon.length
  if (n < 3) return false
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * 计算点集的算术平均中心（质心近似，仅用于嵌套分类的层级判断）。
 * @param points - 二维点集。
 * @returns 平均中心点。
 */
export function polygonCentroid(points: NestPoint[]): NestPoint {
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  return { x: cx / points.length, y: cy / points.length }
}

/**
 * 判断 inner 包围盒是否被 outer 包围盒完全包含（用于子路径嵌套层级预筛）。
 * @param outer - 外层包围盒。
 * @param inner - 内层包围盒。
 * @returns true 当且仅当 inner 落在 outer 内部。
 */
export function bboxContains(
  outer: { minX: number; minY: number; maxX: number; maxY: number },
  inner: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY && inner.maxY <= outer.maxY
}

/**
 * 嵌套分类核心：将闭合子路径分组为外轮廓 + 孔洞（evenodd 语义）。
 *
 * 算法：
 * 1. 按有符号面积绝对值降序排（大轮廓优先）
 * 2. 对每条子路径 A，找到直接包含它的最小外轮廓 B（bbox 包含 + 质心射线法）
 * 3. 按嵌套深度奇偶分组：深度 0 为外轮廓、深度 1 为孔、深度 2 为「孔中岛」
 *    （岛是独立的第二层外轮廓，potrace 等导出器会把落在孔洞区域内的装饰子路径
 *    输出为独立闭合子路径，单层模型会将其丢弃导致该区域被错误镂空）、
 *    深度 3 为岛的孔，依此类推。
 *
 * 返回索引分组（sorted 序），由调用方组装为自己的数据结构。
 *
 * @param subpaths - the closed subpaths to classify (any type with points/bbox/signedArea).
 * @returns the nested groups referencing indices into the sorted array.
 */
export function classifyNested(subpaths: ClassifiableSubpath[]): { outerIdx: number; holes: number[] }[] {
  const sorted = [...subpaths].sort((a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea))
  // 排序后各元素在原数组中的索引（恒等 map 会导致面积序 ≠ 原序时索引错位：
  // 文本多字符轮廓按字符顺序进入、按面积排序后 outer/holes 全部张冠李戴）。
  const sortedIndex = subpaths.map((_, i) => i).sort(
    (a, b) => Math.abs(subpaths[b].signedArea) - Math.abs(subpaths[a].signedArea),
  )

  const parentOf = new Array(sorted.length).fill(-1)
  for (let i = 0; i < sorted.length; i++) {
    let bestParent = -1
    let bestParentArea = Infinity
    const centroid = polygonCentroid(sorted[i].points)
    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue
      if (Math.abs(sorted[j].signedArea) <= Math.abs(sorted[i].signedArea)) continue
      if (!bboxContains(sorted[j].bbox, sorted[i].bbox)) continue
      if (!pointInPolygon(centroid, sorted[j].points)) continue
      if (Math.abs(sorted[j].signedArea) < bestParentArea) {
        bestParentArea = Math.abs(sorted[j].signedArea)
        bestParent = j
      }
    }
    parentOf[i] = bestParent
  }

  const depthOf = new Array<number>(sorted.length).fill(0)
  for (let i = 0; i < sorted.length; i++) {
    let d = 0
    let p = parentOf[i]
    const seen = new Set<number>()
    while (p !== -1 && !seen.has(p)) {
      seen.add(p)
      d++
      p = parentOf[p]
    }
    depthOf[i] = d
  }

  const groups: { outerIdx: number; holes: number[] }[] = []
  const groupIdxOfOuter = new Map<number, number>()
  for (let i = 0; i < sorted.length; i++) {
    if (depthOf[i] % 2 === 0) {
      groupIdxOfOuter.set(i, groups.length)
      groups.push({ outerIdx: sortedIndex[i], holes: [] })
    }
  }
  for (let i = 0; i < sorted.length; i++) {
    if (depthOf[i] % 2 === 1) {
      // 深度 1（或 3/5…）：孔，挂到最近的偶数深度祖先所在的 group
      let p = parentOf[i]
      const seen = new Set<number>()
      while (p !== -1 && !seen.has(p)) {
        seen.add(p)
        if (depthOf[p] % 2 === 0) break
        p = parentOf[p]
      }
      const groupIdx = p === -1 ? -1 : (groupIdxOfOuter.get(p) ?? -1)
      if (groupIdx >= 0 && groupIdx < groups.length) {
        groups[groupIdx].holes.push(sortedIndex[i])
      }
    }
  }

  return groups
}
