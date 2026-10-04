/**
 * api pattern — linearPattern（手写覆盖生成投影，Phase 3: L3 `replica[k]` 角色表）
 *
 * 生成投影是 brep-only compatOp，不带角色表；本文件手写 defineOp，BREP 路径
 * 用质心聚类把结果面按份数 k 分组、回投影到输入面角色，产出 `replica[k]/<inner>`。
 *
 * 机制（无内核历史，纯几何推理）：pattern 的每份副本都是输入的精确平移，副本面
 * 几何相同但质心不同。结果面沿 pattern 方向投影得到份数坐标 t，四舍五入到 spacing
 * 倍数即得 k；再按「面内坐标」（centroid − t·dir）匹配输入面对应面，回投其 inner role。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { solidToShape } from '../brep/brep-ops'
import { getCurrentStmt, keep } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, brepOf } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import type { BrepHandle } from '../brep/engine/types'
import { buildReplicaRoleTable, type ReplicaTransform } from './internal/replica-role-table'
import { meshPatternProduct, meshSolidBasicEntry } from './internal/mesh-solid-op'

/** 归一化向量（零向量 → [0,0,1] 兜底）。 */
function norm(v: Vec3): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len < 1e-9) return [0, 0, 1]
  return [v[0] / len, v[1] / len, v[2] / len]
}

/** BREP 路径：沿 direction 复制 count 份，质心聚类回投输入面角色。 */
function linearPatternBrep(input: Shape, direction: Vec3, count: number, spacing: number): Shape {
  const kernel = getBrepApi()
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[api/pattern] input is not BREP')

  // Phase 1.6：origin = 本次语句 StmtId。
  const outStmt = String(getCurrentStmt()?.id ?? '')

  // 取 count 份副本。Phase 2：BrepEngineApi.linearPattern 契约统一返回 BrepHandle[]
  // （两内核原生都返回 compound，由适配器拆成数组）——不再有「单句柄 fused」形态。
  const dir = norm(direction)
  const raw = kernel.linearPattern(inputSolid, { x: dir[0], y: dir[1], z: dir[2] }, spacing, count)

  let resultSolid: BrepHandle
  try {
    resultSolid = kernel.fuseAll(raw)
  } finally {
    for (const c of raw) kernel.release(c)
  }

  // 第 k 份副本是输入沿 dir 平移 k*spacing：质心反投回输入坐标系（T_k⁻¹）。
  const replicas: ReplicaTransform[] = []
  for (let k = 0; k < count; k++) {
    const off = k * spacing
    replicas.push({
      label: `replica[${k}]`,
      inverse: (c) => ({ x: c.x - off * dir[0], y: c.y - off * dir[1], z: c.z - off * dir[2] }),
    })
  }
  const roleTable = buildReplicaRoleTable(kernel, input, resultSolid, replicas, outStmt)

  return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid, roleTable })
}

/**
 * 网格实体路径：沿 direction 阵列并把副本融成一个网格零件。
 *
 * 与 BREP 路径同一条内核契约（`linearPattern` 返回含原位置在内的 count 个句柄，
 * 再 `fuseAll` 成一体），差别只在**没有 quality 面角色可回投**——近似拓扑没有 role
 * 层，故不产 `replica[k]/<inner>` 命名（如实缺席，不伪造恒等映射）。
 *
 * @param input - the mesh-solid input.
 * @param direction - the pattern direction.
 * @param count - total number of copies (including the original).
 * @param spacing - the spacing between copies.
 * @returns the fused mesh solid as a new mesh part.
 */
function linearPatternMeshSolid(input: Shape, direction: Vec3, count: number, spacing: number): Shape {
  const entry = meshSolidBasicEntry(input, 'linearPattern')
  const d = norm(direction)
  return meshPatternProduct(entry, 'linearPattern', 'E_PATTERN_FAILED', () =>
    entry.kernel.linearPattern(entry.solid, { x: d[0], y: d[1], z: d[2] }, spacing, count),
  )
}

/**
 * 线性阵列：沿 direction 复制 count 份（含原位置）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name linearPattern
 * @note BREP 输入走质心聚类回投，结果面按份数 k 回投影到输入面角色，产出
 *       `replica[k]/<inner>`（Phase 3 L3 抗重放词汇）；**网格实体**输入走网格后端，
 *       阵列后融合为一个新的网格零件，近似拓扑没有 role 层故不产 replica 命名。
 *       裸网格输入仍抛 `E_MESH_UNSUPPORTED`。
 * @returns Shape 所有副本 fused 后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param direction - 阵列方向。type:[x,y,z] required:true
 * @param count - 副本总数（含原位置）。type:number required:true
 * @param spacing - 副本间距。type:number required:true
 * @example
 * const p = await cad.linearPattern(part0, [1, 0, 0], 3, 20)
 */
export const linearPattern = defineOp({
  meshEngines: ['brepkit'],
  mesh(input: Shape, direction: Vec3, count: number, spacing: number) {
    keep(input)
    // 裸网格输入由 `meshSolidBasicEntry` 如实拒绝（近似链没有 role 层，也没有句柄）——
    // 这里不复刻一遍判定，失败面只有一处。
    return linearPatternMeshSolid(input, direction, count, spacing)
  },
  brep(input: Shape, direction: Vec3, count: number, spacing: number) {
    // copy-like keep semantics: replicate ops preserve their source shape.
    keep(input)
    return linearPatternBrep(input, direction, count, spacing)
  },
  // Phase 1（Brep 引擎可切换重构）：能力前置判定——linearPattern 需要内核的
  // 线性阵列方法（BrepMethodKind），brepkit 装配下缺失时执行前静态报错。
  capabilities: ['linearPattern'],
  naming: { kind: 'replicate', k: 0 } as Provenance,
})
