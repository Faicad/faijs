/**
 * GeomRef 解析辅助函数
 *
 * 从分派逻辑（dispatcher）提取，供多个操作分派器共享。
 *
 * P5-2：增加 faceOrdinal 拓扑引用支持。
 * 面找回优先级链：
 * 1. faceOrdinal → BREP getSubShapes(solid,'face')[ordinal] → 面心/法向（拓扑引用）
 * 2. anchor 最近面 + 法向相似度匹配 → 面心/法向（几何反查，兜底）
 * 3. 无 anchor 或 faceAt 失败 → throw（不降级到 bboxCenter）
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import type { GeomRef } from '../lang/types'
import { isAssetRef, isGeomRef, isParamRef } from '../lang/types'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { PartName } from '../identity'

// re-export for backward compat（dispatcher 等仍从 geom-ref 导入）
export { isAssetRef, isGeomRef, isParamRef }

/**
 * BREP 面查询回调类型：从 part 名获取上游 OCCT 实体句柄。
 *
 * 当 BREP 链活跃时，dispatcher 传入此回调使 resolveGeomRef 能按 faceOrdinal
 * 直接取面（拓扑引用，不需要几何反查）。
 */
export type GetUpstreamSolid = (id: PartName) => ShapeHandle | undefined

/**
 * GeomRef 求值器
 *
 * @param ref GeomRef 引用
 * @param getUpstreamGeometry 从 part 名获取上游 mesh 几何（用于 anchor 兜底和 bboxCenter）
 * @param getUpstreamSolid 从 part 名获取上游 OCCT 实体句柄（可选，用于 faceOrdinal 拓扑引用）
 * @param kernel OCCT 内核（可选，用于 faceOrdinal 取面）
 */
export function resolveGeomRef(
  ref: GeomRef,
  getUpstreamGeometry: (id: PartName) => Shape | undefined,
  getUpstreamSolid?: GetUpstreamSolid,
  kernel?: OcctKernel,
): Vec3 {
  const { of, feature, anchor, faceOrdinal } = ref.$geom
  const shape = getUpstreamGeometry(of)
  if (!shape) {
    throw new Error(`[GeomRef] upstream geometry "${of}" not found`)
  }

  switch (feature) {
    case 'bboxCenter': {
      return cad.bboxCenter(shape)
    }
    case 'bboxMin': {
      const bb = cad.boundingBox(shape)
      return bb.min
    }
    case 'bboxMax': {
      const bb = cad.boundingBox(shape)
      return bb.max
    }
    case 'faceCenter':
    case 'faceNormal': {
      // 优先路径：faceOrdinal 拓扑引用（BREP 路径）
      if (faceOrdinal !== undefined && getUpstreamSolid && kernel) {
        const solid = getUpstreamSolid(of)
        if (solid) {
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
              const result: Vec3 = feature === 'faceCenter'
                ? [center.x, center.y, center.z]
                : normal
              return result
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
      // 面找回：用 anchor.point + anchor.normal 在几何上找最近面
      const face = cad.faceAt(shape, anchor)
      if (!face) {
        throw new Error(`[GeomRef] faceAt failed for anchor at ${anchor.point}`)
      }
      return feature === 'faceCenter' ? face.center : face.normal
    }
    default: {
      throw new Error(`[GeomRef] unknown feature "${feature}"`)
    }
  }
}
