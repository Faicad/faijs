/**
 * stdlib pattern — linearPattern（手写覆盖生成投影，Phase 3: L3 `replica[k]` 角色表）
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
import { getFaceHashes } from '../brep/face-evolution'
import { getBackends, getCurrentStmt } from '../runtime-state'
import { fromBrep, brepOf, inputRoleTable } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import type { RoleTable } from '../topology/naming/types'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'

/** 归一化向量（零向量 → [0,0,1] 兜底）。 */
function norm(v: Vec3): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len < 1e-9) return [0, 0, 1]
  return [v[0] / len, v[1] / len, v[2] / len]
}

/** BREP 路径：沿 direction 复制 count 份，质心聚类回投输入面角色。 */
function linearPatternBrep(input: Shape, direction: Vec3, count: number, spacing: number): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/pattern] no OCCT kernel')
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/pattern] input is not BREP')

  // Phase 1.6：origin = 本次语句 StmtId。
  const outStmt = String(getCurrentStmt()?.id ?? '')
  const inputTable = inputRoleTable(input) as RoleTable | undefined

  // 输入面角色（hash → role）用于回投 inner
  const inputHashes = getFaceHashes(kernel, inputSolid)
  const inputHashToRole = new Map<number, string>()
  if (inputTable) {
    for (const roles of inputTable.values()) {
      for (const [role, hashes] of roles) for (const h of hashes) inputHashToRole.set(h, role)
    }
  }
  // 输入面质心（用于按面内坐标回投 inner role）
  const inputFaces = kernel.getSubShapes(inputSolid, 'face')
  const inputCentroids = inputFaces.map((f) => kernel.getSurfaceCenterOfMass(f))

  // 取 count 份副本（内核原生 linearPattern：brepkit 返回 BrepHandle[]，occt-wasm
  // 返回已 fused 的 BrepHandle —— 两种形态都按结果面质心聚类，故兼容）
  const dir = norm(direction)
  const raw = (kernel as unknown as {
    linearPattern(s: BrepHandle, d: number[], sp: number, n: number): unknown
  }).linearPattern(inputSolid, [dir[0], dir[1], dir[2]], spacing, count)

  let resultSolid: BrepHandle
  if (Array.isArray(raw)) {
    try {
      resultSolid = kernel.fuseAll(raw)
    } finally {
      for (const c of raw) kernel.release(c)
    }
  } else {
    resultSolid = raw as BrepHandle
  }

  // 结果面 hash / 质心
  const resultHashes = getFaceHashes(kernel, resultSolid)
  const resultFaces = kernel.getSubShapes(resultSolid, 'face')
  const resultCentroids = resultFaces.map((f) => kernel.getSurfaceCenterOfMass(f))

  const roleTable = new Map<string, Map<string, number[]>>()
  const inner = new Map<string, number[]>()

  for (let i = 0; i < resultHashes.length; i++) {
    const c = resultCentroids[i]!
    // 沿 dir 投影得到份数坐标 t，四舍五入到 spacing 倍数 → k
    const t = c.x * dir[0] + c.y * dir[1] + c.z * dir[2]
    const k = Math.round(t / spacing)
    // 面内坐标 = centroid − t·dir
    const inPlane: [number, number, number] = [c.x - t * dir[0], c.y - t * dir[1], c.z - t * dir[2]]
    // 匹配输入面（最近面内坐标）→ inner role
    let bestRole: string | undefined
    let bestDist = Infinity
    for (let j = 0; j < inputCentroids.length; j++) {
      const ic = inputCentroids[j]!
      const it = ic.x * dir[0] + ic.y * dir[1] + ic.z * dir[2]
      const ii: [number, number, number] = [ic.x - it * dir[0], ic.y - it * dir[1], ic.z - it * dir[2]]
      const d = (inPlane[0] - ii[0]) ** 2 + (inPlane[1] - ii[1]) ** 2 + (inPlane[2] - ii[2]) ** 2
      if (d < bestDist) {
        bestDist = d
        bestRole = inputHashToRole.get(inputHashes[j]!)
      }
    }
    const role = `replica[${k}]/${bestRole ?? 'face'}`
    if (!inner.has(role)) inner.set(role, [])
    inner.get(role)!.push(resultHashes[i]!)
  }
  roleTable.set(outStmt, inner)

  return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid, roleTable })
}

/**
 * 线性阵列：沿 direction 复制 count 份（含原位置）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name linearPattern
 * @note BREP-only：非 BREP 输入抛 E_MESH_UNSUPPORTED。结果面按份数 k 回投影到输入面
 *       角色，产出 `replica[k]/<inner>`（Phase 3 L3 抗重放词汇）。
 * @returns Shape 所有副本 fused 后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param direction - 阵列方向。type:[x,y,z] required:true
 * @param count - 副本总数（含原位置）。type:number required:true
 * @param spacing - 副本间距。type:number required:true
 * @example
 * const p = await cad.linearPattern(part0, [1, 0, 0], 3, 20)
 */
export const linearPattern = defineOp({
  brep(input: Shape, direction: Vec3, count: number, spacing: number) {
    return linearPatternBrep(input, direction, count, spacing)
  },
  // Phase 1（Brep 引擎可切换重构）：能力前置判定——linearPattern 需要内核的
  // 线性阵列方法（BrepMethodKind），brepkit 装配下缺失时执行前静态报错。
  capabilities: ['linearPattern'],
  naming: { kind: 'replicate', k: 0 } as Provenance,
})
