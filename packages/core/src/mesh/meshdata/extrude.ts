/**
 * meshdata/extrude — 2D 轮廓直线拉伸（three r162 `ExtrudeGeometry` 的自有替代）。
 *
 * 语义对齐 three r162 `ExtrudeGeometry`（bevelEnabled=false、steps=1、直线挤压）：
 * - **winding 归一**：外环强制顺时针（CW，Y-up 下 shoelace<0），孔环仅在外环被反转时
 *   把 CW 孔反转（与 three `ExtrudeGeometry.js` L131–L151 行为逐行一致）；
 * - **顶点布局**：与 three 一致输出**非索引三角流**（每三角形 3 个独立顶点副本，
 *   顺序 = 底面 faces → 顶面 faces → 侧壁 quad 拆 (a,b,d)+(b,c,d)），
 *   `indices` 为平凡顺序 0..n-1。因此 positions/normals 与 three r162 逐位一致，
 *   且底/侧/顶棱边保留**硬边法线**（与 three computeVertexNormals 行为相同）；
 * - **三角化**：earcut **2.2.x**（three r162 内置 `Earcut.js` 同版本快照，输出逐位一致）。
 *
 * 与 three 的差异（登记为设计决策）：
 * - three `Shape.extractPoints(curveSegments)` 会把每段（含直线）细分为
 *   curveSegments+1 个冗余点（LineCurve 插值点）；本实现**不细分直线**（曲线已在
 *   `primitives/svg/svg-path.ts` / 文本链采样成折线）。直线的细分点与端点共线，
 *   在几何（去重后）层面完全等价；golden 对照按三角形流逐位断言（见
 *   test/mesh/meshdata-extrude.test.ts），用例输入不含曲线段。
 * - 不支持 bevel / extrudePath：传入即抛错（报错好于掩盖，全仓未使用）。
 *
 * 坐标约定：输入轮廓为 **Y-up 平面坐标**（+Z 向上），拉伸沿 +Z，
 * 底面 z=0、顶面 z=depth。
 */
import earcut from 'earcut'
import type { Shape } from '../types'
import { computeVertexNormals } from './ops'
import type { Contour, P2 } from './contour'
import { signedArea2 } from './contour'

export type { Contour, P2 } from './contour'

/** 拉伸配置。 */
export interface ExtrudeShapeOptions {
  /** 曲线采样段数（曲线已在输入轮廓中折线化，本参数仅保留语义占位）。 */
  curveSegments?: number
  /** 是否支持 bevel（本项目不支持，传 true 抛错）。 */
  bevelEnabled?: boolean
}

/**
 * 将一组 2D 轮廓直线拉伸为 3D 网格（bevel off）。
 *
 * 输出为 three r162 `ExtrudeGeometry`（bevelEnabled:false）的同构三角流：
 * `positions` = 每三角形 3 顶点副本（底→顶→侧壁），`indices` = 顺序 0..n-1，
 * `normals` = 硬边法线（computeVertexNormals 于该非索引布局上）。
 *
 * @param contours - the closed 2D contours (Y-up) to extrude.
 * @param depth - the extrusion depth along +Z.
 * @param opts - optional settings.
 * @returns the extruded indexed Shape (with per-vertex normals).
 * @throws when bevel is requested (unsupported) or depth is non-positive.
 */
export function extrudeShape(contours: Contour[], depth: number, opts?: ExtrudeShapeOptions): Shape {
  if (opts?.bevelEnabled) {
    throw new Error('[extrudeShape] bevel is not supported; use plain straight extrusion')
  }
  if (!(depth > 0)) {
    throw new Error(`[extrudeShape] depth must be positive, got ${depth}`)
  }

  const positions: number[] = []

  for (const contour of contours) {
    addContourShape(contour, depth, positions)
  }

  const indices = new Uint32Array(positions.length / 3)
  for (let i = 0; i < indices.length; i++) indices[i] = i

  const shape: Shape = {
    positions: Float32Array.from(positions),
    indices,
  }
  shape.normals = computeVertexNormals(shape)
  return shape
}

function addContourShape(contour: Contour, depth: number, positions: number[]): void {
  // 1. winding 归一（复刻 three L131–L151）
  let outer = contour.outer.slice()
  removeDupEndPts(outer)
  if (outer.length < 3) return
  const holes = contour.holes.map((h) => h.slice()).filter((h) => h.length >= 3)
  for (const h of holes) removeDupEndPts(h)

  // 1b. 净化相邻重复点（零长度段）。opentype 字形路径常含连续命令终点相同的
  // 退化段（如 `L 3.12,-0.098 L 3.12,-0.098`）；earcut 2.2.4 对这类输入会输出
  // 重叠/退化三角（same edge 出现 4 次 → 非流形）。主动删除相邻同坐标点，
  // 使 earcut 输入与侧壁环一致（earcut 内部 filterPoints 仅删共线，不保证
  // 对零长度段输出干净三角化）。
  removeAdjacentDup(outer)
  for (const h of holes) removeAdjacentDup(h)
  if (outer.length < 3) return

  const reverse = !isClockWise(outer)
  if (reverse) {
    outer = outer.reverse()
    for (const h of holes) {
      if (isClockWise(h)) h.reverse()
    }
  }

  // 2. earcut 三角化（外环 + 孔，earcut 2.2.x 与 three r162 内置输出一致）
  const data: number[] = []
  const holeIndices: number[] = []
  for (const p of outer) data.push(p.x, p.y)
  for (const h of holes) {
    holeIndices.push(data.length / 2)
    for (const p of h) data.push(p.x, p.y)
  }
  const faces = earcut(data, holeIndices.length > 0 ? holeIndices : undefined, 2)

  // 顶点索引（earcut 输出）→ 坐标
  const verts: P2[] = [...outer]
  for (const h of holes) verts.push(...h)
  const at = (i: number): P2 => verts[i]

  // 3a. 底面（法线朝 -Z）：f3(c, b, a)
  for (let i = 0; i < faces.length; i += 3) {
    const p = at(faces[i + 2])
    positions.push(p.x, p.y, 0)
    const q = at(faces[i + 1])
    positions.push(q.x, q.y, 0)
    const r = at(faces[i])
    positions.push(r.x, r.y, 0)
  }

  // 3b. 顶面（法线朝 +Z）：f3(a, b, c)
  for (let i = 0; i < faces.length; i += 3) {
    const p = at(faces[i])
    positions.push(p.x, p.y, depth)
    const q = at(faces[i + 1])
    positions.push(q.x, q.y, depth)
    const r = at(faces[i + 2])
    positions.push(r.x, r.y, depth)
  }

  // 3c. 侧壁：基于 earcut 输出三角的**边界边**（无向出现 1 次的边）生成 quad。
  // - 内部共享边在相邻三角中方向相反（各出现 1 次有向）→ 必须按**无向** key 计数
  //   才不会被误判为边界；
  // - 这样底面/顶面的边界与侧壁严格共享同一组边 → 网格必然水密；
  //   earcut 内部会过滤共线点（filterPoints），若侧壁改用未过滤的输入环，
  //   被滤点在侧壁有边、在顶底没有 → 出现开放边。本实现从几何上消除该不一致。
  // - earcut 输出三角方向统一为外环方向（CW），边界边首次出现的有向方向
  //   (a→b) 即环方向 → quad 法线朝外。
  const edgeCount = new Map<string, { a: number; b: number; n: number }>()
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i], b = faces[i + 1], c = faces[i + 2]
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const key = u < v ? `${u},${v}` : `${v},${u}`
      const entry = edgeCount.get(key)
      if (entry) {
        entry.n++
      } else {
        edgeCount.set(key, { a: u, b: v, n: 1 })
      }
    }
  }
  for (const { a, b, n } of edgeCount.values()) {
    if (n !== 1) continue
    const pa = at(a)
    const pb = at(b)
    // 与 three `sidewalls` 相同的 quad 拆分，但取**反向边 (b→a)**：
    // three 的 sidewalls 从 contour 尾部向前遍历（等价于取环反向），本实现
    // 直接以反向边构造 quad —— tri (a底, b底, a顶) + tri (b底, b顶, a顶)，
    // 法线朝外（earcut 外环为数学 CW，正向 (a→b) 沿 CW 行进右转朝内）。
    positions.push(pa.x, pa.y, 0)
    positions.push(pb.x, pb.y, 0)
    positions.push(pa.x, pa.y, depth)
    positions.push(pb.x, pb.y, 0)
    positions.push(pb.x, pb.y, depth)
    positions.push(pa.x, pa.y, depth)
  }
}

/**
 * three `ShapeUtils.isClockWise`：shoelace 面积 < 0 即顺时针（Y-up，与
 * three `ShapeUtils.area(pts) < 0` 逐字一致）。注意数学约定里逆时针为正，
 * three 命名 "isClockWise" 判的是面积为负（数学 CW）；本实现与 three 对齐。
 */
function isClockWise(pts: P2[]): boolean {
  return signedArea2(pts) < 0
}

/** three `removeDupEndPts`：删除与首点重复的尾点。 */
function removeDupEndPts(pts: P2[]): void {
  const l = pts.length
  if (l > 2 && Math.abs(pts[l - 1].x - pts[0].x) < 1e-12 && Math.abs(pts[l - 1].y - pts[0].y) < 1e-12) {
    pts.pop()
  }
}

/**
 * 删除环上相邻的重复坐标点（零长度段），循环至稳定。
 * 判定容差 1e-9（比 earcut filterPoints 的严格 ===0 更宽，保证净化后的环
 * 不再含任何可判定的零长度段；共线非重复点仍留给 earcut 处理）。
 */
function removeAdjacentDup(pts: P2[]): void {
  let changed = true
  while (changed && pts.length >= 3) {
    changed = false
    for (let i = pts.length - 1; i >= 0; i--) {
      const j = i + 1 >= pts.length ? 0 : i + 1
      if (Math.abs(pts[i].x - pts[j].x) < 1e-9 && Math.abs(pts[i].y - pts[j].y) < 1e-9) {
        pts.splice(i, 1)
        changed = true
      }
    }
  }
}
