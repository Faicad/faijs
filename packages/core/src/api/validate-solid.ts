/**
 * api validate-solid — 产物体检（`cad.validateSolid`）
 *
 * ## 为什么需要
 *
 * case8 的教训：`nonmanifold_edges=0` / `watertight=true` / 体积吻合**只证明"这个形状
 * 是干净的实体"**，不证明"这个形状是对的"（尺寸错、截面放错平面都照样是干净实体）。
 * 但反过来说，**连干净都做不到的时候，现在没有任何出口能告诉你**——非流形边数只能
 * 靠外部脚本数 STL，`unifySameDomain` 的脏结果就这样一路交付出去。
 *
 * 本 op 把这件事变成一次调用：任意产物 → 一份与 `case8/run/part_stl_check.json`
 * 的 `stats` 同名同义的体检报告。
 *
 * ## 为什么是普通函数而不是 defineOp
 *
 * 返回**纯数据**（非 Shape），`defineOp` 的 brep 包装会把返回值一律收养为 Shape，
 * 装不下报告对象。数据型平台 op 走普通函数是既定口径（先例：`api/shape-type` 的布尔
 * 谓词、`measureVolume`）。
 *
 * ## 判定口径
 *
 * 闭合性判据与布尔操作数校验**共用同一份**（`internal/mesh-closure.ts`），避免
 * "同一件几何在布尔入口判闭合、在体检出口判漏水"。
 *
 * 必须先物化网格：BREP 产物在 'defer' 模式下延迟三角化（`brep/deferred-tess.ts`），
 * 直接读 `positions` 会拿到空载荷、把任何实体都误报成"非闭合"。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { brepOf } from '../shape'
import { getBrepApi } from '../brep/handle-bridge'
import { materializeTessellation } from '../brep/brep-ops'
import { meshClosure } from './internal/mesh-closure'

/** 产物体检报告。字段与 `case8/run/part_stl_check.json` 的 `stats` 同名同义。 */
export interface SolidReport {
  /** 三角面数（物化后）。 */
  triangles: number
  /** 包围盒（mm）。 */
  box: {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
  }
  /** 体积（mm³）。非实体（壳/面）时为 0。 */
  volume_mm3: number
  /** BREP 边数（拓扑边，不是网格边）。 */
  edge_count: number
  /** 非流形边数（网格无向边被 >2 个三角共用）。 */
  nonmanifold_edges: number
  /** 边界边数（网格无向边只被 1 个三角用 = 洞的边界）。 */
  boundary_edges: number
  /** 网格闭合（全部无向边计数恰为 2）。 */
  watertight: boolean
  /** 退化为零面积的面数（BREP 面面积 ≈ 0）。 */
  degenerate_faces: number
}

/** 退化面判定阈值（mm²）。低于此值视为零面积碎片。 */
const DEGENERATE_AREA_EPS = 1e-9

/**
 * 产物体检：非流形边 / 边界边 / 闭合性 / 包围盒 / 体积 / 退化面。
 *
 * @param shape - 待体检的产物（任意 Shape；mesh-only 形状报 `E_VALIDATE_NO_BREP`）。
 * @returns 体检报告（纯数据）。
 * @throws `E_VALIDATE_NOT_TESSELATED` 网格为空（未物化且无三角载荷）。
 * @throws `E_VALIDATE_NO_BREP` 形状不带 BREP 句柄（只有 mesh，量不了体积/包围盒）。
 */
export function validateSolid(shape: Shape): SolidReport {
  const handle = brepOf(shape) as BrepHandle | undefined
  if (handle === undefined) {
    throw new Error('E_VALIDATE_NO_BREP: validateSolid requires a BREP handle (mesh-only shape has none)')
  }
  // 先物化：'defer' 模式下 positions 是空的，不物化会把实体误报成"非闭合"
  try {
    materializeTessellation(shape)
  } catch {
    /* 物化失败不阻断体检：下面按现有载荷判，并在 triangles=0 时报未物化 */
  }
  const pos = shape.positions
  const idx = shape.indices
  const closure = meshClosure(pos ?? new Float32Array(0), idx ?? new Uint32Array(0))
  if (closure.tris === 0) {
    throw new Error(
      'E_VALIDATE_NOT_TESSELATED: validateSolid needs a tessellated shape (triangles=0). ' +
        'BREP results are lazily tessellated in defer mode — call this on a terminal shape, ' +
        'or materialize it first.',
    )
  }

  const kernel = getBrepApi()
  const bb = kernel.getBoundingBox(handle)
  const size: [number, number, number] = [
    bb.xmax - bb.xmin,
    bb.ymax - bb.ymin,
    bb.zmax - bb.zmin,
  ]
  const volume = kernel.getVolume(handle)

  const subFaces = kernel.getSubShapes(handle, 'face')
  let degenerateFaces = 0
  try {
    for (const f of subFaces) {
      try {
        const area = kernel.getSurfaceArea(f)
        if (Number.isFinite(area) && Math.abs(area) <= DEGENERATE_AREA_EPS) degenerateFaces++
      } catch {
        /* 面积查询失败不计退化 */
      }
    }
  } finally {
    for (const f of subFaces) {
      try { kernel.release(f) } catch { /* 已释放 */ }
    }
  }
  const edgeCount = kernel.subShapeCount(handle, 'edge')

  return {
    triangles: closure.tris,
    box: {
      min: [bb.xmin, bb.ymin, bb.zmin],
      max: [bb.xmax, bb.ymax, bb.zmax],
      size,
    },
    volume_mm3: volume,
    edge_count: edgeCount,
    nonmanifold_edges: closure.nonmanifoldEdges,
    boundary_edges: closure.boundaryEdges,
    watertight: closure.closed,
    degenerate_faces: degenerateFaces,
  }
}
