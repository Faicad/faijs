/**
 * api compound — 平台几何复合体 op（H11 / 方案 §4.2）
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
import { isCompoundLike, brepOf, fromBrep, type CompoundShape } from '../shape'
import { getBackends, BrepUnsupportedError } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { solidToShape } from '../brep/brep-ops'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'

/** 把任意成员（Shape 或结构 compound）展平为若干子 mesh。 */
function collectSubMeshes(s: Shape | CompoundShape): Shape[] {
  if (isCompoundLike(s)) {
    const out: Shape[] = []
    for (const c of s.children) out.push(...collectSubMeshes(c))
    return out
  }
  if (s.positions && s.indices) return [s]
  return []
}

/**
 * mesh 路径：合并成员 mesh（展平结构 compound 子节点）。
 *
 * @param members - 待合并的成员（结构 compound 递归展平）。
 * @returns 合并后的单一 mesh Shape。
 */
export function mergeMeshes(members: Array<Shape | CompoundShape>): Shape {
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
 * `cad.compound({ members, name?, dropSubsumed? })` → 几何复合体 Shape（持 OCCT 句柄）。
 *
 * @group 结构
 * @inputs 1
 * @qual ok
 * @name compound
 * @param params.members - 成员数组（Shape 或结构 compound；编译产物 ctx.<var> 引用）。type:Shape[]
 * @param params.name - 可选名称。type:string
 * @param params.dropSubsumed - 可选「吞并删除」参与成员的下标列表（BREP-only）。type:number[]
 * @note 成员经 `params.members` 传入，不是位置参数。与编辑器 `cad.group` 的区别：本 op 产出**几何**复合体（持 OCCT 句柄，可放置/导出），`group` 是结构壳（无句柄）。平台侧不要用 `group`。
 * @note `dropSubsumed` 是 FreeCAD truth（`export-fcstd-truth.py` 的
 *       `drop_cumulative_part_design`，经 fcstd-port `freecad-parity.py` 逐条移植）的
 *       内核侧镜像：成员 i（在列表内）被更晚的列表内成员 j 以「逐 solid 体积和
 *       ≥ i 的 ×(1−1e−6) 且 i 的包围盒落在 j 的包围盒内（容差 1e−6·max(1,|b|))」
 *       吞并时，i 从复合体中删除。不在列表内的成员既不被删也不参与吞并（对应
 *       truth 的 `is_pd` 门槛）。典型用途：Body-less PartDesign 链的中间特征
 *       结果是 truth root（减材料步骤永不吞并前一特征），需要按同规则裁剪后
 *       才能与 FreeCAD 场景对齐。
 * @returns Shape 几何复合体（brep 路径持句柄，可变换/可导出）。
 * @example
 * const c = cad.compound({ members: [part0, part1] })
 * @example
 * // drop members fully subsumed by a later member (FreeCAD truth mirror)
 * const c = cad.compound({ members: [pad, pocket, pad001], dropSubsumed: [0, 1, 2] })
 */
export function compound(params: {
  members?: Array<Shape | CompoundShape>;
  name?: string;
  dropSubsumed?: number[];
}): Shape {
  const members = params.members ?? []
  const dropIdx = params.dropSubsumed ?? []
  const { config } = getBackends()
  // D12 中立取核；引擎未初始化（纯 mesh 场景）→ null 容忍走 mesh 路径。
  let kernel: BrepEngineApi | null = null
  try { kernel = getBrepApi() } catch { /* no engine -> mesh path */ }

  // 结构 compound 是结构壳（无 OCCT 句柄）：不在 BREP 链上 → 视为无句柄成员。
  const handles = members.map((m) => (isCompoundLike(m) ? undefined : brepOf(m)))
  const allBrep = !!kernel && handles.every((h) => h !== undefined)

  if (config.mode === 'brep' && !allBrep) {
    throw new BrepUnsupportedError(
      'E_BREP_UNSUPPORTED: compound members are not all on the BREP chain',
    )
  }

  // brep 路径：合并为 TopoDS_Compound 并登记句柄
  if (allBrep && config.mode !== 'mesh') {
    let kept = handles as BrepHandle[]
    if (dropIdx.length > 0) kept = dropSubsumedMembers(kernel!, kept, dropIdx)
    const compoundHandle = kernel!.makeCompound(kept)
    const mesh = solidToShape(kernel!, compoundHandle)
    return fromBrep(mesh, { solid: compoundHandle })
  }

  // dropSubsumed 是 BREP-only 能力：mesh 路径不得静默忽略（静默 = 几何错）。
  if (dropIdx.length > 0) {
    throw new BrepUnsupportedError(
      'E_BREP_UNSUPPORTED: compound dropSubsumed requires the BREP chain',
    )
  }

  // mesh 路径：合并成员 mesh
  return mergeMeshes(members)
}

/**
 * `drop_cumulative_part_design` 的逐条移植（见 op JSDoc 的规则说明）。
 * 体积口径与 truth 一致：逐 solid 求和（复合体整体体积不可靠），
 * ≤1e−12 时回退整形状体积（线/面片）。
 */
function dropSubsumedMembers(
  kernel: BrepEngineApi,
  handles: BrepHandle[],
  eligibleIdx: readonly number[],
): BrepHandle[] {
  const eligible = new Set(eligibleIdx.filter((i) => Number.isInteger(i) && i >= 0 && i < handles.length))
  if (eligible.size < 2) return handles
  const vol: number[] = []
  const bb: Array<[number, number, number, number, number, number]> = []
  for (let i = 0; i < handles.length; i++) {
    if (!eligible.has(i)) continue
    let v = 0
    for (const s of kernel.getSubShapes(handles[i]!, 'solid')) v += kernel.getVolume(s)
    if (v <= 1e-12) v = kernel.getVolume(handles[i]!)
    vol[i] = v
    const b = kernel.getBoundingBox(handles[i]!)
    bb[i] = [b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax]
  }
  const kept: BrepHandle[] = []
  for (let i = 0; i < handles.length; i++) {
    if (eligible.has(i) && vol[i]! > 0) {
      let superseded = false
      for (let j = i + 1; j < handles.length; j++) {
        if (!eligible.has(j) || vol[j]! < vol[i]! * (1 - 1e-6)) continue
        const a = bb[i]!
        const b = bb[j]!
        const tol = 1e-6 * Math.max(1, Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]), Math.abs(b[3]), Math.abs(b[4]), Math.abs(b[5]))
        if (
          a[0] >= b[0] - tol && a[1] >= b[1] - tol && a[2] >= b[2] - tol &&
          a[3] <= b[3] + tol && a[4] <= b[4] + tol && a[5] <= b[5] + tol
        ) {
          superseded = true
          break
        }
      }
      if (superseded) continue
    }
    kept.push(handles[i]!)
  }
  return kept
}
