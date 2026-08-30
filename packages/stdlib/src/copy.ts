/**
 * stdlib copy — 深拷贝几何（方案 B：独立新对象，源不变）
 *
 * 设计文档：docs/plans/2026-08-27-restore-dag-terminal-detection.md §5.1
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * copy 是"共享读取"（克隆出新对象，源不变），与 drill/transform 的"独占改写"本质不同：
 * - **copy 不消费其源**（从消费方排除，与 group/assembly 同级）
 * - copy 输出是独立新对象 → 归"新名"类（allocate-id.ts 不保名）
 * - **源显示**（part0=box; part1=copy(part0) → 画布显示 box 和副本两份）
 *
 * 双链路：
 * - mesh 路径：深拷贝 positions/indices 到新数组
 * - BREP 路径：kernel.copy(inputSolid) → solidToShape → fromBrep 登记
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops'
import { identityEvolution } from '@faicad/faijs-core/brep/face-evolution'
import { getBackends, keep } from '@faicad/faijs-core/runtime-state'
import { solid, fromBrep, brepOf } from '@faicad/faijs-core/shape'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'

/** BREP 实现标记（copy 有 OCCT 精确实体复制 API） */
const brepImpl = true

/** BREP 路径：kernel.copy 深拷贝实体 + 恒等面演化 + 三角化 + fromBrep 一次登记。 */
function copyBrep(input: Shape): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/copy] no OCCT kernel')
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/copy] input is not BREP')

  const copiedSolid = kernel.copy(inputSolid)

  return fromBrep(solidToShape(kernel, copiedSolid), {
    solid: copiedSolid,
    // copy 不改变拓扑，面 ordinal 不变
    faceEvolution: identityEvolution(kernel, copiedSolid),
  })
}

/**
 * `cad.copy(input)` → 深拷贝 Shape。
 *
 * 函数体 keep 声明（keep-syntax 设计 §2.5）：copy 保留其源（可见）——
 * keep(input) 使源变量保持终端（画布显示 box 和副本两份）。
 *
 * mesh 路径：positions/indices 复制到新数组（改副本不影响源）。
 * BREP 路径：kernel.copy 产出独立 ShapeHandle。
 */
/**
 * 深拷贝几何为独立新对象（源不变，源与副本都显示）。
 * @group 特征
 * @inputs 1
 * @async false
 * @qual ok
 * @name copy
 * @param input - 源几何。type:Shape required:true
 * @returns Shape 源几何的深拷贝。copy 不消费其源（画布显示 box 和副本两份），改副本不影响源。
 * @example
 * const part1 = cad.copy(part0)
  */
export function copy(input: Shape): Shape {
  if (!input) throw new Error('[stdlib/copy] no input geometry')
  keep(input)
  const path = dispatchPath([input], brepImpl)
  if (path === 'brep') return copyBrep(input)
  // mesh 路径：深拷贝到新 TypedArray
  return solid({
    positions: new Float32Array(input.positions),
    indices: new Uint32Array(input.indices),
  })
}
