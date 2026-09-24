/**
 * stdlib shell — 抽壳：按面移除生成等厚薄壁（手写中立 op，Phase 5）
 *
 * 中立 op：L1 `shell(solid, facesToRemove, thickness, tolerance)` 在 occt 与
 * brepkit 两侧均有真实现（engine-method-map 实测 `dialect`）⇒ 走 `getBrepApi()`
 * （D12），不声明 engines（中立 op：实现只经 L1 契约面）。相对现状是
 * 能力升级——vendored 版是 occt 平台 op（arg-spec `engines:['occt']`，skip）。
 *
 * 选面口径（设计原则 4）：`openFaces: FaceTopoRef[]`（`cad.faceRef` 产物），
 * 与 `fillet` 的 `EdgeTopoRef[]` / `extrude` 的 `upTo` 同族；不复刻 vendored 的
 * `Face[]` 句柄入参。解析在 op 内一处完成（`buildEdgeResolutionContext` 现场枚举
 * + `resolveTopoRef`）。
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

/** `cad.shell` 参数。 */
export interface ShellParams {
  /** 抽壳时移除的面（FaceTopoRef[]，`cad.faceRef` 产物；空数组 = 全封闭薄壁）。 */
  openFaces: FaceTopoRef[]
  /** 壁厚（mm，>0，向内偏置）。 */
  thickness: number
  /** 容差（mm，可选；默认走内核约定值）。 */
  tolerance?: number
}

/** BREP 路径：解析面引用 → L1 shell → 收养。 */
function shellBrep(input: Shape, params: ShellParams): Shape {
  const { openFaces, thickness, tolerance } = params ?? ({} as ShellParams)
  if (!Array.isArray(openFaces)) {
    throw new Error('E_SHELL_BAD_OPEN_FACES: shell.openFaces must be an array of FaceTopoRef')
  }
  if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) {
    throw new Error('E_SHELL_BAD_THICKNESS: shell.thickness must be a positive number')
  }
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('E_SHELL_NO_BREP: shell input is not BREP')

  const ctx = buildEdgeResolutionContext(kernel, input as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'shell: input has no BREP naming context')
  const faceHandles = openFaces.map((ref) => {
    if (!ref || (ref as { kind?: unknown }).kind !== 'face') {
      throw new Error('E_SHELL_BAD_OPEN_FACES: every openFaces entry must be a FaceTopoRef (cad.faceRef)')
    }
    const r = resolveTopoRef(ref, ctx)
    if (r.handle === undefined) {
      throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `shell: face resolved without handle (${ref.origin}/${ref.role})`)
    }
    return r.handle as BrepHandle
  })

  const result = kernel.shell(solid, faceHandles, thickness, tolerance ?? 1e-6)
  return fromBrep(solidToShape(kernel, result), { solid: result })
}

/**
 * 抽壳：移除指定面并把余下面偏置成等厚薄壁。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name shell
 * @note 中立 op：L1 shell 两引擎同实现。`openFaces` 为空数组时生成全封闭薄壁。
 *       仅 BREP 可用：mesh 输入执行前报错（backend-dispatch 静态判定）。
 * @returns Shape 抽壳后的薄壁体。
 * @param input - 目标几何。type:Shape required:true
 * @param params.openFaces - 要移除的面（FaceTopoRef[]，cad.faceRef 产物）。type:FaceTopoRef[] required:true
 * @param params.thickness - 壁厚（mm，>0）。type:number required:true
 * @param params.tolerance - 容差（mm）。type:number required:false
 * @example
 * const sh = await cad.shell(part0, { openFaces: [cad.faceRef(part0, 1)], thickness: 2 })
 */
export const shell = defineOp({
  capabilities: ['directEdit'],
  brep(input: Shape, params: ShellParams) {
    return shellBrep(input, params)
  },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
