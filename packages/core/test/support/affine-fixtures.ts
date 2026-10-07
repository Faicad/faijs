/**
 * 仿射变换语料：`applyMatrix` / `scaleBrep` 相关回归测试共用的矩阵、形状与量尺
 * （2026-10-07 建立）。
 *
 * 为什么单独成模块：下面两个测试文件吃的是**同一批语料**和**同一把量尺**——
 * `test/brep/applymatrix-similarity-routing.test.ts`（判据表 + 双引擎不变量）与
 * `test/brep/occt-gtrsf-tessellation-gotcha.test.ts`（occt 原生缺陷刻画）。
 * 语料复制两份会各自漂移，两边的数字就不再可比；`test/support/` 是本仓既有的
 * 共享测试模块落点（见 `support/editor-ops.ts`）。
 *
 * 本模块不注册引擎、不写 `describe`/`it`：调用方负责 `configureBackends` 并传入面。
 * `meshShape` / `getBoundingBox` 在 L1 契约面与 occt 原生面上同名同形，所以同一组
 * 读数函数能同时量两层、直接把两层的结果并排对照。
 */

import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'

// ── 矩阵语料（3×4 row-major，12 double）──

/** 7 位小数打印的 60° Z 旋转 —— openscad 语料里 `multmatrix` 的实际形态。 */
export const ROT_Z60_TRUNCATED = [0.5, -0.8660254, 0, 0, 0.8660254, 0.5, 0, 0, 0, 0, 1, 0]

/** 同一旋转的全精度形态。 */
export const ROT_Z60_FULL = [
  0.5, -Math.sin(Math.PI / 3), 0, 0, Math.sin(Math.PI / 3), 0.5, 0, 0, 0, 0, 1, 0,
]

/** 旋转 × 等比 3（仍是相似变换）。 */
export const ROT_Z60_SCALED3 = [
  1.5, -0.8660254 * 3, 0, 0, 0.8660254 * 3, 1.5, 0, 0, 0, 0, 3, 0,
]

/** 非等比：Z 方向 ×2.5（必须走 GTrsf）。 */
export const SCALE_Z25 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2.5, 0]

/** 错切（必须走 GTrsf）。 */
export const SHEAR_XY = [1, 0.3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

/** 镜像：det < 0，但线性部分仍是等比正交 ⇒ 判为相似（行为与修复前一致）。 */
export const MIRROR_X = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

/** 单位矩阵。 */
export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

/** 退化矩阵（第一行为零）⇒ 非相似。 */
export const DEGENERATE = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

/** 纯 Z 平移 +2（相似变换）。 */
export const TRANSLATE_Z2 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2]

/** 60° Z 旋转 + Z 平移 +2。 */
export const ROT_Z60_TZ2 = [0.5, -0.8660254, 0, 0, 0.8660254, 0.5, 0, 0, 0, 0, 1, 2]

// ── 形状语料 ──

/** 平面上的点（z = 0）。 */
export const P3 = (x: number, y: number): { x: number; y: number; z: number } => ({ x, y, z: 0 })

/** 由平面点序列造一条闭合直线 wire。 */
export function rectWire(k: BrepEngineApi, pts: [number, number][]): BrepHandle {
  const edges: BrepHandle[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    edges.push(k.makeLineEdge(P3(a[0], a[1]), P3(b[0], b[1])))
  }
  const w = k.makeWire(edges)
  for (const e of edges) k.release(e)
  return w
}

/**
 * 挤出高度 `height` 的方形棱柱（无孔）。
 *
 * 注意：顶盖的 z 偏移**不记在几何里**，而是一条 `TopLoc_Location`（`tz = height`）。
 * 这是 occt 的正常优化（位置可共享、纯移动 O(1)），但正是
 * `occt-gtrsf-tessellation-gotcha.test.ts` 里那个缺陷的载体——所以这个形状不是随便
 * 取的，它同时是「判据表」和「缺陷刻画」的语料。
 */
export function extrudedPrism(k: BrepEngineApi, height: number): BrepHandle {
  return k.extrude(k.makeFace(rectWire(k, [[1, 1], [6, 1], [6, 6], [1, 6]])), 0, 0, height)
}

/**
 * 复刻 `cad.profile` + `cad.extrude` 的产物：外环 + 孔 → planar face → 挤出 5。
 * 这是 example023 / openscad parity 的原始语料。
 *
 * 孔**不是**那个 occt 缺陷的先决条件（无孔棱柱同样中招，见 `extrudedPrism`）；
 * 判据测试与缺陷测试都跑这一形态即可覆盖两条路径。
 */
export function extrudedPrismWithHole(k: BrepEngineApi): BrepHandle {
  const outer = rectWire(k, [[1, 1], [6, 1], [6, 6], [1, 6]])
  const hole = rectWire(k, [[3, 3], [5, 3], [5, 5], [3, 5]])
  return k.extrude(k.addHolesInFace(k.makeFace(outer), [hole]), 0, 0, 5)
}

// ── 量尺 ──

/** 三角化结果的形状（只取量 bbox 需要的两个数组）。 */
export interface MeshLike {
  positions: ArrayLike<number>
  indices: ArrayLike<number>
}

/**
 * 量尺只需要两个能力：三角化 + bbox。L1 契约面与 occt 原生面都具备同名同形的方法，
 * 故同一组函数能同时量两层——这是「原生有缺陷 / L1 已绕过」能并排对照的前提。
 */
export interface MeasureFace {
  meshShape(
    shape: unknown,
    options: { linearDeflection: number; angularDeflection: number },
  ): MeshLike
  getBoundingBox(shape: unknown, useTriangulation?: boolean): { zmin: number; zmax: number }
}

/** 与 `brep-ops.ts` 内建 op 一致的口径（linearDeflection 0.1 / 32 段）。 */
export const TESS_OPTIONS = { linearDeflection: 0.1, angularDeflection: (2 * Math.PI) / 32 }

/**
 * 三角化一次并返回网格。
 *
 * 副作用是**关键**：occt 的三角化缓存挂在形状上，量过一次 `hasTriangulation` 即由
 * false 变 true，后续所有变换都在「已缓存三角化」的输入上进行。缺陷测试里
 * 「未预 mesh」与「已预 mesh」的对照就靠这个副作用区分。
 */
export function meshOf(k: MeasureFace, shape: unknown): MeshLike {
  return k.meshShape(shape, TESS_OPTIONS)
}

/** 三角化后用到的顶点 Z 范围。 */
export function meshZRange(k: MeasureFace, shape: unknown): [number, number] {
  const m = meshOf(k, shape)
  let min = Infinity
  let max = -Infinity
  for (const v of Array.from(m.indices)) {
    const z = m.positions[v * 3 + 2]!
    if (z < min) min = z
    if (z > max) max = z
  }
  return [min, max]
}

/** 内核**精确** bbox 的 Z 范围（与是否三角化无关，是几何真值）。 */
export function exactZRange(k: MeasureFace, shape: unknown): [number, number] {
  const bb = k.getBoundingBox(shape)
  return [bb.zmin, bb.zmax]
}

/**
 * 按**缓存三角化**求 bbox 的 Z 范围。
 * 与 `exactZRange` 的差就是「网格与几何是否自洽」的直接判据（occt-wasm 的
 * `getBoundingBox` 文档明确保证精确模式与三角化无关）。
 */
export function triangulatedZRange(k: MeasureFace, shape: unknown): [number, number] {
  const bb = k.getBoundingBox(shape, true)
  return [bb.zmin, bb.zmax]
}

/**
 * 被索引引用到的顶点按 z 分桶计数（z 量化到 1e-3）。
 * 用来分辨「整体多变换一次」与「某个面单独飘走」——后者的特征是只有该面的顶点数被位移。
 */
export function zHistogram(k: MeasureFace, shape: unknown): Map<number, number> {
  const m = meshOf(k, shape)
  const seen = new Set<number>()
  const hist = new Map<number, number>()
  for (const v of Array.from(m.indices)) {
    if (seen.has(v)) continue
    seen.add(v)
    const z = Number(m.positions[v * 3 + 2]!.toFixed(3))
    hist.set(z, (hist.get(z) ?? 0) + 1)
  }
  return hist
}

/**
 * 从 BREP 原文读 `Locations N` 段的条目数。
 * 用途：记录「重建形状」是否给形状新增了 TopLoc 条目（occt 的 GTrsf 重建会多出一条）。
 */
export function locationEntryCount(raw: { toBREP(shape: unknown): string }, shape: unknown): number {
  const line = raw
    .toBREP(shape)
    .split('\n')
    .find((l) => l.trim().startsWith('Locations'))
  return line ? Number(line.trim().split(/\s+/)[1]) : -1
}
