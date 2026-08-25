/**
 * stdlib boolean — 布尔库函数（union/subtract/intersect，多输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/boolean.ts 迁出并改写为 stdlib 形态：
 * `(...rest)`（末参 exec，倒数第二参 params，其余为输入 Shape），
 * resolvePath 静态判定 brep/mesh，BREP 路径用 *WithHistory 收集面演化。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { solidToShape } from '../brep/brep-ops'
import {
  cutWithHistoryBrep,
  fuseWithHistoryBrep,
  intersectWithHistoryBrep,
} from '../brep/face-evolution'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import type { ExecContext } from '../cad-runtime/exec-context'

/** BREP 实现标记（boolean 有 OCCT 精确布尔） */
const brepImpl = true

/** BREP 路径：fuse/cut/common（*WithHistory 封装，收集面演化）。 */
function booleanBrep(inputs: Shape[], params: Record<string, unknown>, exec: ExecContext): Shape {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/boolean] no OCCT kernel')
  const operation = params.operation as 'union' | 'subtract' | 'intersect'

  const inputSolids = inputs.map((s) => exec.getSolid(s))
  if (inputSolids.some((s) => !s)) {
    throw new Error('[stdlib/boolean] input is not BREP')
  }

  let resultSolid: import('occt-wasm').ShapeHandle
  let lastEvolution: Map<number, number[]> | undefined

  const applyBinary = (
    a: import('occt-wasm').ShapeHandle,
    b: import('occt-wasm').ShapeHandle,
  ): { result: import('occt-wasm').ShapeHandle; faceEvolution?: Map<number, number[]> } => {
    if (operation === 'union') return fuseWithHistoryBrep(kernel, a, b)
    if (operation === 'subtract') return cutWithHistoryBrep(kernel, a, b)
    return intersectWithHistoryBrep(kernel, a, b)
  }

  const first = applyBinary(inputSolids[0]!, inputSolids[1]!)
  resultSolid = first.result
  lastEvolution = first.faceEvolution
  for (let i = 2; i < inputSolids.length; i++) {
    const prev = resultSolid
    const r = applyBinary(prev, inputSolids[i]!)
    resultSolid = r.result
    lastEvolution = r.faceEvolution
    kernel.release(prev)
  }

  const shape = solid(solidToShape(kernel, resultSolid))
  exec.setSolid(shape, resultSolid)
  if (lastEvolution) exec.setFaceEvolution(shape, lastEvolution)
  return shape
}

/** mesh 路径：manifold-3d mesh-CSG。 */
async function booleanMesh(inputs: Shape[], operation: 'union' | 'subtract' | 'intersect'): Promise<Shape> {
  if (inputs.length < 2) {
    if (inputs.length === 1) return inputs[0]
    throw new Error('[stdlib/boolean] boolean needs at least 1 input')
  }
  if (operation === 'union') return cad.union(inputs[0], inputs[1], ...inputs.slice(2))
  if (operation === 'subtract') {
    let result = await cad.subtract(inputs[0], inputs[1])
    for (let i = 2; i < inputs.length; i++) result = await cad.subtract(result, inputs[i])
    return result
  }
  let result = await cad.intersect(inputs[0], inputs[1])
  for (let i = 2; i < inputs.length; i++) result = await cad.intersect(result, inputs[i])
  return result
}

export async function boolean(...rest: unknown[]): Promise<Shape> {
  const exec = rest.pop() as ExecContext
  const params = (rest.pop() ?? {}) as Record<string, unknown>
  const inputs = rest as Shape[]
  const operation = params.operation as 'union' | 'subtract' | 'intersect'

  const path = resolvePath(exec, inputs, brepImpl)
  if (path === 'brep') return booleanBrep(inputs, params, exec)
  return solid(await booleanMesh(inputs, operation))
}
