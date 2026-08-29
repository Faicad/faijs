/**
 * stdlib copy — 深拷贝几何（方案 B：独立新对象，源不变）
 *
 * 设计文档：docs/plans/2026-08-27-restore-dag-terminal-detection.md §5.1
 *
 * copy 是"共享读取"（克隆出新对象，源不变），与 drill/transform 的"独占改写"本质不同：
 * - **copy 不消费其源**（从消费方排除，与 group/assembly 同级）
 * - copy 输出是独立新对象 → 归"新名"类（allocate-id.ts 不保名）
 * - **源显示**（part0=box; part1=copy(part0) → 画布显示 box 和副本两份）
 *
 * 双链路：
 * - mesh 路径：深拷贝 positions/indices 到新数组
 * - BREP 路径：kernel.copy(inputSolid) → solidToShape → setSolid/setFaceEvolution
 */

import type { Shape } from '../mesh/types'
import { solidToShape } from '../brep/brep-ops'
import { identityEvolution } from '../brep/face-evolution'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import type { ExecContext } from '../cad-runtime/exec-context'

/** BREP 实现标记（copy 有 OCCT 精确实体复制 API） */
const brepImpl = true

/** BREP 路径：kernel.copy 深拷贝实体 + 恒等面演化 + 三角化 + 身份槽挂 solid。 */
function copyBrep(input: Shape, exec: ExecContext): Shape {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/copy] no OCCT kernel')
  const inputSolid = exec.getSolid(input)
  if (!inputSolid) throw new Error('[stdlib/copy] input is not BREP')

  const copiedSolid = kernel.copy(inputSolid)

  const shape = solid(solidToShape(kernel, copiedSolid))
  exec.setSolid(shape, copiedSolid)
  // copy 不改变拓扑，面 ordinal 不变
  exec.setFaceEvolution(shape, identityEvolution(kernel, copiedSolid))
  return shape
}

/**
 * `cad.copy(input, exec)` → 深拷贝 Shape。
 *
 * 统一 ABI：(…sourceVisibleArgs, exec)。copy 无 args（空 args 槽不发射），
 * 编译产物 `cad.copy(ctx.part0, exec)`。
 *
 * 函数体 keep 声明（keep-syntax 设计 §2.5）：copy 保留其源（可见）——
 * exec.keep(input) 使源变量保持终端（画布显示 box 和副本两份）。
 *
 * mesh 路径：positions/indices 复制到新数组（改副本不影响源）。
 * BREP 路径：kernel.copy 产出独立 ShapeHandle。
 */
export function copy(input: Shape, exec: ExecContext): Shape {
  if (!input) throw new Error('[stdlib/copy] no input geometry')
  exec.keep(input)
  const path = resolvePath(exec, [input], brepImpl)
  if (path === 'brep') return copyBrep(input, exec)
  // mesh 路径：深拷贝到新 TypedArray
  return solid({
    positions: new Float32Array(input.positions),
    indices: new Uint32Array(input.indices),
  })
}
