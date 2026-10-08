/**
 * api split — split（手写覆盖生成投影，Phase 3: L4 `splinter(#j)` 角色表）
 *
 * @platform occt — 平台 op：内核原生 `split`（BRepAlgoAPI_Splitter）是 occt-only
 * （engine-method-map `split` → occt-only；L1 只有 `splitByPlane`）。本文件
 * 只取 L1 面做枚举/命名（getBrepApi），切分本身走平台面 getOcctKernel()（D3），
 * defineOp 声明 `engines: ['occt']`（D11），不声明其它收窄。
 *
 * 生成投影是 brep-only compatOp，不带角色表；本文件手写 defineOp，BREP 路径
 * 用内核原生 split（BRepAlgoAPI_Splitter）切分，存活面（hash 逐字不变）回投原
 * role，新造面（截面 + 被切细的侧面片）记 `splinter(#j)`，片序按质心排序保证跨
 * 重放稳定。
 *
 * 机制（无 splitWithHistory，纯 hash 比对 + 几何排序）：`subdivide` 类零声明，
 * 新造面不对应任何输入面的因果坐标，故挂消费它的那条语句、用稳定的片序 `#j` 区分。
 */

import type { Shape } from '../mesh/types'
import { solidToShape } from '../brep/brep-ops'
import { getFaceHashes } from '../brep/face-evolution'
import { getBrepApi } from '../brep/handle-bridge'
import { getCurrentStmt } from '../runtime-state'
import { fromBrep, brepOf, inputRoleTable } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import type { RoleTable } from '../topology/naming/types'
import type { BrepHandle } from '../brep/engine/types'
import { getOcctKernel, type ShapeHandle } from '../occt-kernel/occtKernel'

/** BREP 路径：用 tools 切分 input，存活面回投、新造面记 `splinter(#j)`。 */
function splitBrep(input: Shape, tools: Shape[]): Shape {
  // L1 面：枚举/命名（getBrepApi，D12）。
  const kernel = getBrepApi()
  // 平台面：原生 split（occt-only，D3）。
  const occtKernel = getOcctKernel()
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[api/split] input is not BREP')
  const toolSolids = tools
    .map((t) => brepOf(t) as BrepHandle | undefined)
    .filter((s): s is BrepHandle => !!s)
  if (toolSolids.length === 0) return input

  // Phase 1.6：origin = 本次语句 StmtId。
  const outStmt = String(getCurrentStmt()?.id ?? '')
  const inputTable = inputRoleTable(input) as RoleTable | undefined

  const inputHashes = getFaceHashes(kernel, inputSolid)
  const inputHashSet = new Set(inputHashes)
  const inputHashToRole = new Map<number, string>()
  if (inputTable) {
    for (const roles of inputTable.values()) {
      for (const [role, hashes] of roles) for (const h of hashes) inputHashToRole.set(h, role)
    }
  }

  // 内核原生 split（BRepAlgoAPI_Splitter）返回包含所有碎片的 compound。
  // BrepHandle（branded number）与 occt-wasm ShapeHandle（branded number）运行时同构，
  // 品牌转换只发生在平台边界（occt-only 原生面，非跨引擎断言）。
  const resultSolid = occtKernel.split(
    inputSolid as unknown as ShapeHandle,
    toolSolids as unknown as ShapeHandle[],
  )

  const resultHashes = getFaceHashes(kernel, resultSolid as unknown as BrepHandle)
  const resultFaces = kernel.getSubShapes(resultSolid as unknown as BrepHandle, 'face')
  const resultCentroids = resultFaces.map((f) => kernel.surfaceCenterOfMass(f))

  const roleTable = new Map<string, Map<string, number[]>>()
  const inner = new Map<string, number[]>()

  // 存活面（hash 逐字不变）→ 回投原 role；其余 = 新造面 → splinter(#j)
  const newFaces: { hash: number; c: { x: number; y: number; z: number } }[] = []
  for (let i = 0; i < resultHashes.length; i++) {
    const h = resultHashes[i]!
    if (inputHashSet.has(h)) {
      const role = inputHashToRole.get(h)
      if (role) {
        if (!inner.has(role)) inner.set(role, [])
        inner.get(role)!.push(h)
      }
    } else {
      newFaces.push({ hash: h, c: resultCentroids[i]! })
    }
  }
  // 按质心 (x,y,z) 排序保证片序跨重放稳定
  newFaces.sort((a, b) => a.c.x - b.c.x || a.c.y - b.c.y || a.c.z - b.c.z)
  for (let j = 0; j < newFaces.length; j++) {
    const role = `splinter(#${j})`
    inner.set(role, [newFaces[j].hash])
  }
  roleTable.set(outStmt, inner)

  return fromBrep(solidToShape(kernel, resultSolid as unknown as BrepHandle), {
    solid: resultSolid as unknown as BrepHandle,
    roleTable,
  })
}

/**
 * 用工具几何切分目标几何（BRepAlgoAPI_Splitter），返回所有碎片组成的几何。
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name split
 * @note BREP-only：非 BREP 输入抛 E_MESH_UNSUPPORTED。切分产生的截面 / 被切细的侧面
 *       片记 `splinter(#j)`（Phase 3 L4 抗重放词汇）。平台 op：仅 occt 引擎（原生 split）。
 * @returns Shape 切分后的几何（compound of pieces）。
 * @param input - 目标几何。type:Shape required:true
 * @param tools - 切刀几何（数组）。type:Shape[] required:true
 * @example
 * const pieces = await cad.split(part0, [part1])
 */
export const split = defineOp({
  brep(input: Shape, tools: Shape[]) {
    return splitBrep(input, tools)
  },
  engines: ['occt'],
  naming: { kind: 'subdivide' } as Provenance,
})
