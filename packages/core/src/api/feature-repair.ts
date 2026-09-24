/**
 * stdlib feature-repair — L1 薄包装族（手写中立 op，Phase 5）
 *
 * 六条 L1 已有（两引擎均为 dialect/aligned）的修复/修饰动作的手写薄包装，
 * 全部走 `getBrepApi()`（D12），不声明 engines（D11-7 互斥）：
 * - `defeature(shape, faces)` — 移除特征面（孔/凸台等）
 * - `removeHolesFromFace(face)` — 移除面上的孔
 * - `reverseShape(shape)` — 反转壳体朝向
 * - `unifySameDomain(shape)` — 合并同域面/边
 * - `sew(shapes, tolerance?)` — 缝合壳
 * - `sewAndSolidify(shapes, tolerance?)` — 缝合并固化为实体
 *
 * 每条都极薄：解析入参 → 直调 L1 → 收养。选面口径与 `shell`/`draft` 一致
 * （FaceTopoRef[]，设计原则 4）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { FaceTopoRef } from '../topology/naming'
import { resolveTopoRef, TopoRefError } from '../topology/naming'
import type { Provenance } from '../topology/naming/lineage'
import { buildEdgeResolutionContext } from './topo-resolve'

type ProvenanceLike = Provenance

/** BREP 输入守卫：取 BREP 句柄，无则报错。 */
function requireBrep(input: Shape, op: string): BrepHandle {
  const handle = brepOf(input) as BrepHandle | undefined
  if (!handle) throw new Error(`E_${op.toUpperCase()}_NO_BREP: ${op} input is not BREP`)
  return handle
}

/** 解析 FaceTopoRef[] → 句柄数组（shell/draft 同款口径）。 */
function resolveFaces(kernel: ReturnType<typeof getBrepApi>, input: Shape, refs: FaceTopoRef[], op: string): BrepHandle[] {
  const ctx = buildEdgeResolutionContext(kernel, input as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `${op}: input has no BREP naming context`)
  return refs.map((ref) => {
    if (!ref || (ref as { kind?: unknown }).kind !== 'face') {
      throw new Error(`E_${op.toUpperCase()}_BAD_FACE_REF: every faces entry must be a FaceTopoRef (cad.faceRef)`)
    }
    const r = resolveTopoRef(ref, ctx)
    if (r.handle === undefined) {
      throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `${op}: face resolved without handle (${ref.origin}/${ref.role})`)
    }
    return r.handle as BrepHandle
  })
}

/** 借入一组输入 Shape → 句柄数组（sew 族）。 */
function borrowHandles(shapes: Shape[], op: string): BrepHandle[] {
  if (!Array.isArray(shapes) || shapes.length === 0) {
    throw new Error(`E_${op.toUpperCase()}_NO_SHAPES: ${op} requires a non-empty array of shapes`)
  }
  return shapes.map((s) => {
    const h = brepOf(s) as BrepHandle | undefined
    if (!h) throw new Error(`E_${op.toUpperCase()}_NO_BREP: ${op} input shape is not BREP`)
    return h
  })
}

function adopt(kernel: ReturnType<typeof getBrepApi>, handle: BrepHandle): Shape {
  return fromBrep(solidToShape(kernel, handle), { solid: handle })
}

const kernelNaming = { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as ProvenanceLike

/**
 * 移除特征面（孔/凸台等），恢复基础形状。
 * @group 修复
 * @inputs 1
 * @async true
 * @qual ok
 * @name defeature
 * @note 中立 op：L1 defeature 两引擎同实现。仅 BREP 可用。
 * @returns Shape 移除特征后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param faces - 要移除的面（FaceTopoRef[]，cad.faceRef 产物）。type:FaceTopoRef[] required:true
 * @example
 * const base = await cad.defeature(part0, [cad.faceRef(part0, 5)])
 */
export const defeature = defineOp({
  capabilities: ['directEdit'],
  brep(input: Shape, faces: FaceTopoRef[]) {
    if (!Array.isArray(faces) || faces.length === 0) {
      throw new Error('E_DEFEATURE_NO_FACES: defeature requires at least one FaceTopoRef')
    }
    const kernel = getBrepApi()
    const solid = requireBrep(input, 'defeature')
    const handles = resolveFaces(kernel, input, faces, 'defeature')
    return adopt(kernel, kernel.defeature(solid, handles))
  },
  naming: kernelNaming,
})

/**
 * 反转壳体朝向（内表面 ↔ 外表面）。
 * @group 修复
 * @inputs 1
 * @async true
 * @qual ok
 * @name reverseShape
 * @note 中立 op：L1 reverseShape 两引擎同实现。仅 BREP 可用。
 * @returns Shape 朝向反转后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @example
 * const flipped = await cad.reverseShape(sh)
 */
export const reverseShape = defineOp({
  capabilities: ['directEdit'],
  brep(input: Shape) {
    const kernel = getBrepApi()
    const solid = requireBrep(input, 'reverseShape')
    return adopt(kernel, kernel.reverseShape(solid))
  },
  naming: kernelNaming,
})

/**
 * 合并同域面/边（去除被分割成多片的冗余细分）。
 * @group 修复
 * @inputs 1
 * @async true
 * @qual ok
 * @name unifySameDomain
 * @note 中立 op：L1 unifySameDomain 两引擎同实现。仅 BREP 可用。
 * @returns Shape 合并后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @example
 * const merged = await cad.unifySameDomain(part0)
 */
export const unifySameDomain = defineOp({
  capabilities: ['directEdit'],
  brep(input: Shape) {
    const kernel = getBrepApi()
    const solid = requireBrep(input, 'unifySameDomain')
    return adopt(kernel, kernel.unifySameDomain(solid))
  },
  naming: kernelNaming,
})

/** `cad.sew` / `cad.sewAndSolidify` 公共参数。 */
export interface SewParams {
  /** 缝合容差（mm，可选）。 */
  tolerance?: number
}

/**
 * 缝合：把一组面/壳沿公共边缝成一张壳。
 * @group 修复
 * @inputs 1
 * @async true
 * @qual ok
 * @name sew
 * @note 中立 op：L1 sew 两引擎同实现。产物是壳（不保证闭合）；要实体用 sewAndSolidify。
 * @returns Shape 缝合后的壳。
 * @param shapes - 面/壳集合。type:Shape[] required:true
 * @param params.tolerance - 缝合容差（mm）。type:number required:false
 * @example
 * const shellShape = await cad.sew([f1, f2, f3], { tolerance: 1e-5 })
 */
export const sew = defineOp({
  capabilities: ['directEdit'],
  brep(shapes: Shape[], params?: SewParams) {
    const kernel = getBrepApi()
    const handles = borrowHandles(shapes, 'sew')
    return adopt(kernel, kernel.sew(handles, params?.tolerance))
  },
  naming: kernelNaming,
})

/**
 * 缝合并固化为实体：缝合后若闭合则生成 solid。
 * @group 修复
 * @inputs 1
 * @async true
 * @qual ok
 * @name sewAndSolidify
 * @note 中立 op：L1 sewAndSolidify 两引擎同实现。仅 BREP 可用。
 * @returns Shape 缝合固化后的实体。
 * @param shapes - 面/壳集合。type:Shape[] required:true
 * @param params.tolerance - 缝合容差（mm）。type:number required:false
 * @example
 * const solid = await cad.sewAndSolidify([f1, f2, f3, f4, f5, f6])
 */
export const sewAndSolidify = defineOp({
  capabilities: ['directEdit'],
  brep(shapes: Shape[], params?: SewParams) {
    const kernel = getBrepApi()
    const handles = borrowHandles(shapes, 'sewAndSolidify')
    return adopt(kernel, kernel.sewAndSolidify(handles, params?.tolerance))
  },
  naming: kernelNaming,
})

/**
 * 移除面（或实体某面）上的孔。
 * @group 修复
 * @inputs 1
 * @async true
 * @qual ok
 * @name removeHolesFromFace
 * @note 中立 op：L1 removeHolesFromFace 两引擎同实现。入参为含孔的面 Shape
 *       （L1 形参是面句柄；借入输入 Shape 的 BREP 槽位句柄）。
 * @returns Shape 去孔后的面。
 * @param face - 含孔的面几何。type:Shape required:true
 * @example
 * const plain = await cad.removeHolesFromFace(faceWithHoles)
 */
export const removeHolesFromFace = defineOp({
  capabilities: ['directEdit'],
  brep(face: Shape) {
    if (!face) throw new Error('E_REMOVEHOLES_NO_FACE: removeHolesFromFace requires a face shape')
    const kernel = getBrepApi()
    const handle = brepOf(face) as BrepHandle | undefined
    if (!handle) throw new Error('E_REMOVEHOLES_NO_BREP: removeHolesFromFace input is not BREP')
    return adopt(kernel, kernel.removeHolesFromFace(handle))
  },
  naming: kernelNaming,
})
