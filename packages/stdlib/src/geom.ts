/**
 * stdlib geom — $geom 查询函数族（有形签名）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.9
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2（§5.5）
 *
 * `cad.<feature>(of, anchor?, ordinal?)`：
 * - of 是 Shape（编译产物 `ctx.<var>` 引用），非变量名
 * - faceCenter/faceNormal：faceOrdinal + brepOf(of) + kernel（拓扑引用）
 *   优先 → anchor 几何反查（兜底）→ 报错
 * - bboxCenter/bboxMin/bboxMax：mesh 包围盒查询
 */

import type { Shape, Vec3 } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { brepOf } from '@faicad/faijs-core/shape'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'

/** 内部实现：faceOrdinal+BREP 优先 → anchor 反查 → 报错（逻辑迁移自 resolveGeomRef）。 */
function geomQuery(
  feature: 'faceCenter' | 'faceNormal',
  of: Shape,
  anchor: Vec3 | undefined,
  faceOrdinal: number | undefined,
): Vec3 {
  // 优先路径：faceOrdinal 拓扑引用（BREP 路径）
  if (faceOrdinal !== undefined) {
    const solid = brepOf(of) as BrepHandle | undefined
    const kernel = getBackends().kernel.brep as BrepEngineApi | null
    if (solid && kernel) {
      try {
        const faces = kernel.getSubShapes(solid, 'face')
        if (faceOrdinal < faces.length) {
          const face = faces[faceOrdinal]
          const center = kernel.getSurfaceCenterOfMass(face)
          // 面法向：用 surfaceNormal 在 (0.5, 0.5) 处取
          let normal: Vec3 = [0, 0, 1]
          try {
            const n = kernel.surfaceNormal(face, 0.5, 0.5)
            normal = [n.x, n.y, n.z]
          } catch {
            // surfaceNormal 可能对某些面失败，用默认法向
          }
          kernel.release(face)
          for (let i = 0; i < faces.length; i++) {
            if (i !== faceOrdinal) kernel.release(faces[i])
          }
          return feature === 'faceCenter' ? [center.x, center.y, center.z] : normal
        }
        // ordinal 越界 → 释放并降级到 anchor
        for (const f of faces) kernel.release(f)
      } catch {
        // BREP 取面失败 → 降级到 anchor
      }
    }
  }

  // 兜底路径：anchor 几何反查
  if (!anchor) {
    throw new Error(`[GeomRef] ${feature} requires anchor or faceOrdinal`)
  }
  const face = cad.faceAt(of, { point: anchor })
  if (!face) {
    throw new Error(`[GeomRef] faceAt failed for anchor at ${anchor}`)
  }
  return feature === 'faceCenter' ? face.center : face.normal
}

/**
 * 查询面上某点（锚点）的中心坐标。faceOrdinal 拓扑引用优先，anchor 几何反查兜底。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name faceCenter
 * @returns Vec3 面上锚点处的中心坐标 [x,y,z]。交互式可编辑（参数量引用）。
 * @param of - 目标几何（编译产物 ctx.<var> 引用）。type:Shape required:true
 * @param anchor - 锚点（几何反查兜底）。type:[x,y,z]
 * @param ordinal - 面序号（BREP 拓扑引用优先）。type:number
 * @example
 * const c = cad.faceCenter(part0, [0, 0, 5])
  */
export function faceCenter(of: Shape, anchor?: Vec3, ordinal?: number): Vec3 {
  return geomQuery('faceCenter', of, anchor, ordinal)
}

/**
 * 查询面上某点（锚点）的法向。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name faceNormal
 * @returns Vec3 面上锚点处的法向 [x,y,z]。
 * @param of - 目标几何（编译产物 ctx.<var> 引用）。type:Shape required:true
 * @param anchor - 锚点（几何反查兜底）。type:[x,y,z]
 * @param ordinal - 面序号（BREP 拓扑引用优先）。type:number
 * @example
 * const n = cad.faceNormal(part0, [0, 0, 5])
  */
export function faceNormal(of: Shape, anchor?: Vec3, ordinal?: number): Vec3 {
  return geomQuery('faceNormal', of, anchor, ordinal)
}

/**
 * 查询几何包围盒中心。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name bboxCenter
 * @returns Vec3 包围盒中心 [x,y,z]。交互式可编辑（参数量引用）。
 * @param of - 目标几何。type:Shape required:true
 * @example
 * const c = cad.bboxCenter(part0)
  */
export function bboxCenter(of: Shape): Vec3 {
  return cad.bboxCenter(of)
}

/**
 * 查询几何包围盒最小角点。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name bboxMin
 * @returns Vec3 包围盒最小角点 [x,y,z]。
 * @param of - 目标几何。type:Shape required:true
 * @example
 * const mn = cad.bboxMin(part0)
  */
export function bboxMin(of: Shape): Vec3 {
  return cad.boundingBox(of).min
}

/**
 * 查询几何包围盒最大角点。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name bboxMax
 * @returns Vec3 包围盒最大角点 [x,y,z]。
 * @param of - 目标几何。type:Shape required:true
 * @example
 * const mx = cad.bboxMax(part0)
  */
export function bboxMax(of: Shape): Vec3 {
  return cad.boundingBox(of).max
}
