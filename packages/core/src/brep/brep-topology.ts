/**
 * BREP 拓扑运行时构建 — 从实体句柄生成 SelectorRuntime + mesh 数据
 *
 * 引擎中立：本文件只经 L1 契约面调用内核（`buildAssemblySelectorManifest` 同理），
 * 已在 occt 与 brepkit 两个引擎上跑通（`topology/face-group-units.test.ts` 的跨引擎
 * 一致性用例）。因此**不再**标注 `@platform occt`——标注与 import 位置都已修正
 * （偏差计算移到 `brep/effective-deflection.ts`；方案 2026-10-01 §3.7）。
 *
 * 与 STEP 文件导入的拓扑提取使用**同源算法**：
 *   meshShape + buildAssemblySelectorManifest + buildSelectorRuntime
 *
 * 不执行 STEP round-trip（export→import），直接在原始 solid 上运行。
 * solid 句柄不被释放或修改——由调用方（宿主导出缓存）管理生命周期。
 *
 * 同时返回 mesh 数据（positions/normals/indices），用于更新场景几何，
 * 保证 mesh 三角形与 topology faceRuns 一一对应。
 */

import type { BrepHandle, BrepMeshResult } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'
import type { SelectorRuntime, SelectorBundle, SelectorManifest, SelectorBuffers } from '../topology/types'
import type { Shape } from '../mesh/types'
import { computeEffectiveDeflection } from './effective-deflection'
import { buildAssemblySelectorManifest, type PartTopologyInput } from '../occt-kernel/topologyExt'
import { buildSelectorRuntime } from '../topology/build-selector-runtime'
import { brepOf } from '../shape'
import { DEFAULT_LINEAR_DEFLECTION } from '../tolerance'
import { mm } from '../units'

/**
 * Result of building BREP topology from an OCCT solid: the SelectorRuntime
 * plus the mesh data produced by the same meshShape call.
 */
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
 * 从已有的三角化结果（meshWithGroups）构建拓扑，不强制重新 meshShape。
 *
 * 用于 BREP 路径在场景已有三角化时复用——三角化属于几何数据生成，
 * 拓扑构建应接收已有结果而非内部重新生成（需求 §2.0/§2.2、验收 3）。
 *
 * @param kernel          the OCCT kernel instance.
 * @param solid           the OCCT solid handle (the shapeHandle for buildAssemblySelectorManifest).
 * @param meshWithGroups  the existing tessellation result (from kernel.meshShape).
 * @returns the assembled SelectorRuntime.
 */
export function buildTopologyFromMesh(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  meshWithGroups: BrepMeshResult,
): SelectorRuntime {
  // 生成拓扑清单（与 STEP_T 同源：buildAssemblySelectorManifest）
  const result = buildAssemblySelectorManifest(kernel, [{
    labelPath: 'o1',
    shapeHandle: solid,
    meshWithGroups,
  }])

  // 构建 SelectorRuntime
  const bundle: SelectorBundle = {
    manifest: result.manifest as unknown as SelectorManifest,
    buffers: result.buffers as unknown as import('../topology/types').SelectorBuffers,
  }
  return buildSelectorRuntime(bundle, { scale: 1 })
}

/**
 * 从 OCCT solid 句柄生成 SelectorRuntime + mesh 数据。
 *
 * 算法与 STEP 文件导入路径（step-worker.ts → importStepToMesh →
 * buildAssemblySelectorManifest → buildSelectorRuntime）完全同源，
 * 区别仅在于 solid 来源是 OCCT 运算而非 STEP 文件导入。
 *
 * 三角化参数与显示 mesh 完全一致
 * （linearDeflection=0.1, angularDeflection=2π/32≈0.196, relative=false）。
 * 这与 solidToShape 的默认值一致，保证拓扑 faceRuns 与显示 mesh 三角形一一对应。
 *
 * 规则 1：拓扑数据生成所使用的 mesh，必须是当前用户看到的 mesh。
 * 由于 OCCT meshShape 对同一 solid + 同一参数是确定性的，
 * 此处重新三角化的结果与显示 mesh 完全相同。
 * 如果已有三角化结果（meshShapeCache），应直接调 buildTopologyFromMesh 以复用。
 *
 * @param kernel  the OCCT kernel instance.
 * @param solid   the OCCT solid handle (never released or modified).
 * @returns the SelectorRuntime plus the mesh data from the same meshShape call.
 */
export function buildSolidTopologyRuntime(
  kernel: BrepEngineApi,
  solid: BrepHandle,
): SolidTopologyResult {
  // 1. 三角化（含 faceGroups）——与显示 mesh 使用相同的 deflection 参数
  //    solidToShape 默认 angularDeflection = 2π/32 ≈ 0.196
  const DISPLAY_ANGULAR_DEFLECTION = (2 * Math.PI) / 32
  const eff = computeEffectiveDeflection(kernel, solid, {
    linearDeflection: DEFAULT_LINEAR_DEFLECTION.as(mm),
    angularDeflection: DISPLAY_ANGULAR_DEFLECTION,
    relative: false,
  })
  const mesh: BrepMeshResult = kernel.meshShape(solid, {
    linearDeflection: eff.linearDeflection,
    angularDeflection: eff.angularDeflection,
  })

  // 2. 从已有三角化结果构建拓扑（复用 buildTopologyFromMesh）
  const runtime = buildTopologyFromMesh(kernel, solid, mesh)

  // 3. 返回 runtime + mesh（同一个 meshShape 输出）
  return {
    runtime,
    mesh: {
      positions: mesh.positions.slice(),
      normals: mesh.normals.slice(),
      indices: mesh.indices.slice(),
    },
  }
}

/**
 * 多零件 compound（多 solid STEP）的合并 BREP 拓扑构建。
 *
 * load op 对多零件文件返回 compound，每个 child 带自己的 BREP solid
 * （fromBrep(shape, {solid})；装配变换后经 brepOf(child) 读回最新句柄）。
 * compound 终端没有单一 solidCache 键，buildBrepTopology 必然 miss → 多零件
 * 文件导入后无拓扑（面拾取/装配 overlay 缺失，assembly-dropdown 回归根因）。
 *
 * 这里按 buildAssemblySelectorManifest 的多零件数组输入合并构建：每个成员
 * 独立 meshShape（与 buildSolidTopologyRuntime 同参，确定性输出）得到含
 * faceGroups 的 BrepMeshResult，labelPath 取 `o{index+1}`（与
 * ImportModel.parts.index 一一对应），产出 occurrence-aware SelectorRuntime
 * （occurrenceIdByRowIndex 覆盖全部成员），与 STEP 文件导入路径同源。
 *
 * @param kernel  OCCT 内核
 * @param children compound 的 child 数组（声明序 = importModel.parts.index）
 * @returns 合并后的 SelectorRuntime；任一成员无 BREP solid / 无 kernel 时返回 undefined
 */
export function buildCompoundTopologyRuntime(
  kernel: BrepEngineApi,
  children: Shape[],
): SelectorRuntime | undefined {
  if (!kernel || children.length === 0) return undefined
  const DISPLAY_ANGULAR_DEFLECTION = (2 * Math.PI) / 32
  const inputs: PartTopologyInput[] = []
  for (let i = 0; i < children.length; i++) {
    const solid = brepOf(children[i]) as BrepHandle | undefined
    if (!solid) return undefined
    const eff = computeEffectiveDeflection(kernel, solid, {
      linearDeflection: DEFAULT_LINEAR_DEFLECTION.as(mm),
      angularDeflection: DISPLAY_ANGULAR_DEFLECTION,
      relative: false,
    })
    const mesh: BrepMeshResult = kernel.meshShape(solid, {
      linearDeflection: eff.linearDeflection,
      angularDeflection: eff.angularDeflection,
    })
    inputs.push({ labelPath: `o${i + 1}`, shapeHandle: solid, meshWithGroups: mesh })
  }
  const result = buildAssemblySelectorManifest(kernel, inputs)
  const bundle: SelectorBundle = {
    manifest: result.manifest as unknown as SelectorManifest,
    buffers: result.buffers as unknown as SelectorBuffers,
  }
  return buildSelectorRuntime(bundle, { scale: 1 })
}
