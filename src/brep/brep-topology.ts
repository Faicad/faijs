﻿/**
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
 * 从已有的三角化结果（meshWithGroups）构建拓扑，不强制重新 meshShape。
 *
 * 用于 BREP 路径在场景已有三角化时复用——三角化属于几何数据生成，
 * 拓扑构建应接收已有结果而非内部重新生成（需求 §2.0/§2.2、验收 3）。
 *
 * @param solid  OCCT solid 句柄（用于 buildAssemblySelectorManifest 的 shapeHandle）
 * @param meshWithGroups 已有的三角化结果（来自 kernel.meshShape）
 * @returns SelectorRuntime
 */
export function buildTopologyFromMesh(
  solid: ShapeHandle,
  meshWithGroups: WasmMesh,
): SelectorRuntime {
  // 生成拓扑清单（与 STEP_T 同源：buildAssemblySelectorManifest）
  const result = buildAssemblySelectorManifest([{
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
 * @param kernel OCCT 内核实例
 * @param solid  OCCT solid 句柄（不会被释放或修改）
 */
export function buildSolidTopologyRuntime(
  kernel: OcctKernel,
  solid: ShapeHandle,
): SolidTopologyResult {
  // 1. 三角化（含 faceGroups）——与显示 mesh 使用相同的 deflection 参数
  //    solidToShape 默认 angularDeflection = 2π/32 ≈ 0.196
  const DISPLAY_ANGULAR_DEFLECTION = (2 * Math.PI) / 32
  const eff = computeEffectiveDeflection(kernel, solid, {
    linearDeflection: 0.1,
    angularDeflection: DISPLAY_ANGULAR_DEFLECTION,
    relative: false,
  })
  const mesh: WasmMesh = kernel.meshShape(solid, {
    linearDeflection: eff.linearDeflection,
    angularDeflection: eff.angularDeflection,
  })

  // 2. 从已有三角化结果构建拓扑（复用 buildTopologyFromMesh）
  const runtime = buildTopologyFromMesh(solid, mesh)

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
