/**
 * stdlib compound — 平台几何复合体 op（H11 / 方案 §4.2）
 *
 *
 * 与编辑器 `cad.group`（`api/compound.ts`）的区别：
 * - `group` 是 ../3d_editor 的「结构分组」op：产出 `{kind:'compound', children}`
 *   结构壳（无 OCCT 句柄），意义是层级/画布结构，不可变换、不可导出为实体。
 * - 本 op 是 faijs **平台**几何 op：把多个成员聚成一个**几何复合体**
 *   （OCCT `TopoDS_Compound`，持句柄），可被放置、导出、作为后续 op 的输入。
 *
 * 路径：
 * - brep 路径：`kernel.makeCompound(handles)`（收任意 BrepHandle，含非实体）
 *   → `solidToShape` 三角化 → `fromBrep` 登记句柄。
 * - mesh 路径：合并成员 mesh（结构 compound 子节点展平；纯线框无面成员不贡献网格）。
 *
 * 成员不 keep：复合体是单一几何输出，成员作为子形被吸入，不单独作为终端显示。
 */

import type { Shape } from '../mesh/types'
import { isCompoundLike, brepOf, fromBrep } from '../shape'
import { getBackends, BrepUnsupportedError } from '../runtime-state'
import { solidToShape } from '../brep/brep-ops'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'

/** 把任意 Shape（可能是结构 compound）展平为若干子 mesh。 */
function collectSubMeshes(s: Shape): Shape[] {
  if (isCompoundLike(s) && (s as { children?: Shape[] }).children) {
    const out: Shape[] = []
    for (const c of (s as { children: Shape[] }).children) out.push(...collectSubMeshes(c))
    return out
  }
  if (s.positions && s.indices) return [s]
  return []
}

/** mesh 路径：合并成员 mesh（展平结构 compound 子节点）。 */
export function mergeMeshes(members: Shape[]): Shape {
  const positions: number[] = []
  const indices: number[] = []
  for (const m of members) {
    for (const sub of collectSubMeshes(m)) {
      const base = positions.length / 3
      positions.push(...sub.positions)
      for (let i = 0; i < sub.indices.length; i++) indices.push(sub.indices[i] + base)
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/**
 * `cad.compound({ members, name? })` → 几何复合体 Shape（持 OCCT 句柄）。
 *
 * @group 结构
 * @inputs 1
 * @qual ok
 * @name compound
 * @param params.members - 成员 Shape 数组（编译产物 ctx.<var> 引用）。type:Shape[]
 * @param params.name - 可选名称。type:string
 * @note 成员经 `params.members` 传入，不是位置参数。与编辑器 `cad.group` 的区别：本 op 产出**几何**复合体（持 OCCT 句柄，可放置/导出），`group` 是结构壳（无句柄）。平台侧不要用 `group`。
 * @returns Shape 几何复合体（brep 路径持句柄，可变换/可导出）。
 * @example
 * const c = cad.compound({ members: [part0, part1] })
 */
export function compound(params: { members?: Shape[]; name?: string }): Shape {
  const members = params.members ?? []
  const { config, kernel: kernels } = getBackends()
  const kernel = kernels.brep as BrepEngineApi | null

  const handles = members.map((m) => brepOf(m) as BrepHandle | undefined)
  const allBrep = !!kernel && handles.every((h) => h !== undefined)

  if (config.mode === 'brep' && !allBrep) {
    throw new BrepUnsupportedError(
      'E_BREP_UNSUPPORTED: compound members are not all on the BREP chain',
    )
  }

  // brep 路径：合并为 TopoDS_Compound 并登记句柄
  if (allBrep && config.mode !== 'mesh') {
    const compoundHandle = kernel!.makeCompound(handles as BrepHandle[])
    const mesh = solidToShape(kernel!, compoundHandle)
    return fromBrep(mesh, { solid: compoundHandle })
  }

  // mesh 路径：合并成员 mesh
  return mergeMeshes(members)
}
