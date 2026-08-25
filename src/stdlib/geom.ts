/**
 * stdlib geom — $geom 查询函数族（末参 exec）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.9
 *
 * 从 src/ops/geom-ref.ts 的 resolveGeomRef 迁出并改写为 stdlib 形态：
 * `cad.<feature>(of, anchor?, ordinal?, exec)`，末参 exec。
 * - of 是 Shape（编译产物 `ctx.<var>` 引用），非变量名
 * - faceCenter/faceNormal：faceOrdinal + exec.getSolid(of) + kernel（拓扑引用）
 *   优先 → anchor 几何反查（兜底）→ 报错
 * - bboxCenter/bboxMin/bboxMax：mesh 包围盒查询
 *
 * 统一 `(...rest)` 形态：末参 exec（编译产物固定最后传 exec），其余为
 * of / anchor? / ordinal?——与编译产物的可变参数调用（无 anchor、仅 ordinal 等）一致。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import type { ExecContext } from '../cad-runtime/exec-context'

/** 内部实现：faceOrdinal+BREP 优先 → anchor 反查 → 报错（逻辑迁移自 resolveGeomRef）。 */
function geomQuery(
  feature: 'faceCenter' | 'faceNormal',
  of: Shape,
  anchor: Vec3 | undefined,
  faceOrdinal: number | undefined,
  exec: ExecContext,
): Vec3 {
  // 优先路径：faceOrdinal 拓扑引用（BREP 路径）
  if (faceOrdinal !== undefined) {
    const solid = exec.getSolid(of)
    const kernel = exec.kernels.occt
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

/** `cad.faceCenter(of, anchor?, ordinal?, exec)` */
export function faceCenter(...rest: unknown[]): Vec3 {
  const exec = rest.pop() as ExecContext
  const of = rest[0] as Shape
  const anchor = rest[1] as Vec3 | undefined
  const ordinal = rest[2] as number | undefined
  return geomQuery('faceCenter', of, anchor, ordinal, exec)
}

/** `cad.faceNormal(of, anchor?, ordinal?, exec)` */
export function faceNormal(...rest: unknown[]): Vec3 {
  const exec = rest.pop() as ExecContext
  const of = rest[0] as Shape
  const anchor = rest[1] as Vec3 | undefined
  const ordinal = rest[2] as number | undefined
  return geomQuery('faceNormal', of, anchor, ordinal, exec)
}

/** `cad.bboxCenter(of, exec)` */
export function bboxCenter(...rest: unknown[]): Vec3 {
  const of = rest[0] as Shape
  return cad.bboxCenter(of)
}

/** `cad.bboxMin(of, exec)` */
export function bboxMin(...rest: unknown[]): Vec3 {
  const of = rest[0] as Shape
  const bb = cad.boundingBox(of)
  return bb.min
}

/** `cad.bboxMax(of, exec)` */
export function bboxMax(...rest: unknown[]): Vec3 {
  const of = rest[0] as Shape
  const bb = cad.boundingBox(of)
  return bb.max
}
