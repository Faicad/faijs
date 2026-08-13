/**
 * BREP 拓扑运行时构建 — 从 OCCT solid 句柄生成 SelectorRuntime + mesh 数据
 *
 * 与 STEP 文件导入的拓扑提取使用**同源算法**：
 *   meshShape + buildAssemblySelectorManifest + buildSelectorRuntime
 *
 * 不执行 STEP round-trip（export→import），直接在原始 solid 上运行。
 * solid 句柄不被释放或修改——由调用方（_brepSolidCache）管理生命周期。
 *
 * 同时返回 mesh 数据（positions/normals/indices），用于更新场景几何，
 * 保证 mesh 三角形与 topology faceRuns 一一对应。
 */

import type { OcctKernel, ShapeHandle, Mesh as WasmMesh } from 'occt-wasm'
import type { SelectorRuntime, SelectorBundle, SelectorManifest } from '../topology/types'
import { computeEffectiveDeflection } from '../occt-kernel/occtKernel'
import { buildAssemblySelectorManifest } from '../occt-kernel/topologyExt'
import { buildSelectorRuntime } from '../topology/build-selector-runtime'

export interface SolidTopologyResult {
  /** SelectorRuntime，与 STEP_T 使用同源算法生成 */
  runtime: SelectorRuntime
  /** 与 topology 使用同一个 meshShape 输出的 mesh 数据 */
  mesh: {
    positions: Float32Array
    normals: Float32Array
    indices: Uint32Array
  }
}

/**
 * 从 OCCT solid 句柄生成 SelectorRuntime + mesh 数据。
 *
 * 算法与 STEP 文件导入路径（step-worker.ts → importStepToMesh →
 * buildAssemblySelectorManifest → buildSelectorRuntime）完全同源，
 * 区别仅在于 solid 来源是 OCCT 运算而非 STEP 文件导入。
 *
 * 三角化参数使用与 STEP 导入相同的默认值
 * （linearDeflection=0.1, angularDeflection=0.5, relative=false）。
 *
 * @param kernel OCCT 内核实例
 * @param solid  OCCT solid 句柄（不会被释放或修改）
 */
export function buildSolidTopologyRuntime(
  kernel: OcctKernel,
  solid: ShapeHandle,
): SolidTopologyResult {
  // 1. 三角化（含 faceGroups）——与 STEP 导入路径使用相同的 deflection 参数
  const eff = computeEffectiveDeflection(kernel, solid, {
    linearDeflection: 0.1,
    angularDeflection: 0.5,
    relative: false,
  })
  const mesh: WasmMesh = kernel.meshShape(solid, {
    linearDeflection: eff.linearDeflection,
    angularDeflection: eff.angularDeflection,
  })
  // 2. 生成拓扑清单（与 STEP_T 同源：buildAssemblySelectorManifest）
  const result = buildAssemblySelectorManifest([{
    labelPath: 'o1',
    shapeHandle: solid,
    meshWithGroups: mesh,
  }])

  // 3. 构建 SelectorRuntime
  const bundle: SelectorBundle = {
    manifest: result.manifest as unknown as SelectorManifest,
    buffers: result.buffers as unknown as import('../topology/types').SelectorBuffers,
  }
  const runtime = buildSelectorRuntime(bundle, { scale: 1 })

  // 4. 返回 runtime + mesh（同一个 meshShape 输出）
  return {
    runtime,
    mesh: {
      positions: mesh.positions.slice(),
      normals: mesh.normals.slice(),
      indices: mesh.indices.slice(),
    },
  }
}

