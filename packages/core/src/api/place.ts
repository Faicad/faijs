/**
 * stdlib place — 平台刚性放置 op（H11 / 方案 §4.3）
 *
 *
 * 一个刚体变换：先绕局部原点按 `rotation`（四元数）旋转，再平移 `position`
 * （= FreeCAD `Placement` 的 T(P)∘R(Q)）。不接受 pivot——FCStd 语义就是绕局部原点。
 *
 * 路径：
 * - brep 路径：`applyTransformBrep(kernel, solid, quat, [0,0,0], position)`
 *   （复用 api/compound 装配求解已标定的代码，矩阵约定见 §4.3 必做标定）。
 * - mesh 路径：`applyTransform`（与 brep 路径同数学：p' = R·(p−0) + 0 + t）。
 *   四元数→row-major 3×3 用手动 Hamilton 公式（与 THREE / FreeCAD gp_Quaternion
 *   同约定），不引入 three 依赖。
 *
 * 变换不改变拓扑，面 ordinal 不变——roleTable 恒等传播（与 transform.ts 同）。
 */

import type { Shape } from '../mesh/types'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, brepOf, inputRoleTable, isCompoundLike } from '../shape'
import { solidToShape, applyTransformBrep } from '../brep/brep-ops'
import { applyTransform } from '../mesh/rigid-transform'
import { identityEvolution, identityHashEvolution } from '../brep/face-evolution'
import { propagateAllOrigins } from '../topology/naming/roles'
import type { RoleTable } from '../topology/naming/types'
import type { Provenance } from '../topology/naming/lineage'
import { defineOp } from '../sdk'
import type { BrepHandle } from '../brep/engine/types'

/** 四元数 (x,y,z,w) → row-major 3×3 旋转矩阵（Hamilton，与 THREE/FreeCAD 同约定）。 */
function quatToMat3(q: [number, number, number, number]): number[] {
  const [x, y, z, w] = q
  const x2 = x * x
  const y2 = y * y
  const z2 = z * z
  return [
    1 - 2 * (y2 + z2), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x2 + z2), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x2 + y2),
  ]
}

/** mesh 路径：展平结构 compound 子节点，逐子 mesh 变换后合并。 */
function placeMesh(
  input: Shape,
  rotation: [number, number, number, number],
  position: [number, number, number],
  mat3: number[],
): Shape {
  const collect = (s: Shape, out: Shape[]): void => {
    if (isCompoundLike(s) && (s as { children?: Shape[] }).children) {
      for (const c of (s as { children: Shape[] }).children) collect(c, out)
      return
    }
    if (s.positions && s.indices) out.push(s)
  }
  const subs: Shape[] = []
  collect(input, subs)
  const positions: number[] = []
  const indices: number[] = []
  for (const sub of subs) {
    const t = applyTransform(sub, rotation, [0, 0, 0], position, mat3)
    const base = positions.length / 3
    positions.push(...t.positions)
    for (let i = 0; i < t.indices.length; i++) indices.push(t.indices[i] + base)
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/** brep 路径：刚体变换实体 + 恒等面演化 + 恒等 roleTable 传播 + 三角化 + fromBrep 登记。 */
function placeBrep(input: Shape, rotation: [number, number, number, number], position: [number, number, number]): Shape {
  const kernel = getBrepApi()
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[api/place] input is not BREP')

  const resultSolid = applyTransformBrep(kernel, inputSolid, rotation, [0, 0, 0], position)

  const inputTable = inputRoleTable(input) as RoleTable | undefined
  let roleTable: RoleTable | undefined
  if (inputTable && inputTable.size > 0) {
    roleTable = propagateAllOrigins(inputTable, identityHashEvolution(kernel, inputSolid, resultSolid))
  }

  return fromBrep(solidToShape(kernel, resultSolid), {
    solid: resultSolid,
    faceEvolution: identityEvolution(kernel, resultSolid),
    roleTable,
  })
}

/**
 * 刚性放置几何体：旋转（四元数，绕局部原点）后平移。两者皆可缺省 = 恒等。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name place
 * @returns Shape 放置后的几何（持 OCCT 句柄，可继续变换/导出）。
 * @param input - 目标几何。type:Shape required:true
 * @param params.rotation - 旋转四元数 [x,y,z,w]（Hamilton，绕局部原点）。type:[number,number,number,number]
 * @param params.position - 平移向量 [x,y,z]（mm）。type:[number,number,number]
 * @example
 * const p = cad.place(part0, { rotation: [0, 0, Math.sin(Math.PI/4), Math.cos(Math.PI/4)], position: [10, 0, 0] })
 */
export const place = defineOp({
  name: 'place',
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/place] no input geometry')
    const rotation = (params.rotation as [number, number, number, number]) ?? [0, 0, 0, 1]
    const position = (params.position as [number, number, number]) ?? [0, 0, 0]
    return placeMesh(input, rotation, position, quatToMat3(rotation))
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/place] no input geometry')
    const rotation = (params.rotation as [number, number, number, number]) ?? [0, 0, 0, 1]
    const position = (params.position as [number, number, number]) ?? [0, 0, 0]
    return placeBrep(input, rotation, position)
  },
  schema: { position: 'vec3?', rotation: 'quat?' },
  naming: { kind: 'identity' } as Provenance,
})
