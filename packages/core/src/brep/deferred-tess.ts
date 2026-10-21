/**
 * deferred-tess — 延迟三角化描述符与物化（'defer' 模式，方案 2026-10-21）
 *
 * 见 docs/plans/2026-10-21-weapp-tessellation-defer-plan.md §2。
 *
 * 背景：小程序端运行 faijs 的首要性能开销是 BREP 显示三角化（face.fai.js 全量
 * 执行约 30 次 `meshShape`，只有 13 次对应最终终端）。'defer' 模式让每个 BREP op
 * 产出时**不**三角化，挂一个待物化描述符（solid + 创建时记录的参数），由 runtime
 * 在结果收尾时只对**终端**物化——中间产物永不物化。
 *
 * 架构红线（AGENTS.md）：拓扑数据的 mesh 必须与显示 mesh 一致，禁止"同参数再算
 * 一次"的等价性论证。本模块的物化用**创建时记录的参数**调 `kernel.meshShape`，
 * 物化结果写入 shape 的 positions/indices 与 `BREP_TESS` 槽；runtime 把这份结果
 * 同步进 `meshShapeCache`，`buildBrepTopology` 命中**同一份 mesh**——拓扑与显示
 * 完全同源。
 *
 * 零重依赖（sdk.js 静态导入守卫）：运行时只 import `mesh/types`（零依赖模块，
 * 持有 BREP_TESS / BREP_LAZY_TESS / Shape）；`BrepEngineApi` / `BrepHandle` /
 * `BrepMeshResult` 均为类型级 import（构建时擦除，不产生运行时边）。
 */
import { BREP_LAZY_TESS, BREP_TESS, type Shape } from '../mesh/types'
import type { BrepEngineApi } from './engine/primitives'
import type { BrepHandle, BrepMeshResult } from './engine/types'

/**
 * 延迟三角化描述符（`BREP_LAZY_TESS` 槽值）：待物化的 BREP solid + **创建时记录的
 * 三角化参数**。物化必须用这份参数（与 eager 路径一致），否则拓扑 mesh 与显示 mesh
 * 不同源（架构红线）。
 */
export interface BrepLazyTessDescriptor {
  kernel: BrepEngineApi
  solid: BrepHandle
  linearDeflection: number
  angularDeflection: number
  /**
   * 基本体 op 名（box/cylinder/cone）——物化时补挂 shape.faceRanges（与 eager 路径
   * primitives.ts 的面结构白名单一致；sphere/wedge 面结构未建模，不挂）。
   */
  primitiveOp?: 'box' | 'cylinder' | 'cone'
}

/**
 * 该 shape 是否携带未物化的延迟三角化（'defer' 模式产物）。
 * @param shape - 候选 shape。
 * @returns 携带 `BREP_LAZY_TESS` 描述符时为 true。
 */
export function isDeferredTessShape(shape: Shape): boolean {
  return (shape as unknown as Record<symbol, unknown>)[BREP_LAZY_TESS] !== undefined
}

/**
 * 物化延迟三角化：用**创建时记录的参数**调 `kernel.meshShape`，写回 shape 的
 * positions/indices + `BREP_TESS` 槽，并删除 `BREP_LAZY_TESS`（幂等——已物化/无
 * 描述符时 no-op，返回 undefined）。
 *
 * 物化结果与 eager 路径**逐字节一致**（同参数、同内核）。调用方（runtime 收尾 /
 * getCachedOutput / mesh 链分派）负责把返回的 brepTess 写进 `meshShapeCache`
 * （PartName 键），使 `buildBrepTopology` 命中同一份 mesh。
 *
 * @param shape - 待物化的 shape（原地写回）。
 * @returns 物化出的三角化结果（含 faceGroups），无描述符时 undefined。
 */
export function materializeTessellation(shape: Shape): BrepMeshResult | undefined {
  const desc = (shape as unknown as Record<symbol, unknown>)[BREP_LAZY_TESS] as
    | BrepLazyTessDescriptor
    | undefined
  if (!desc) return undefined
  const mesh: BrepMeshResult = desc.kernel.meshShape(desc.solid, {
    linearDeflection: desc.linearDeflection,
    angularDeflection: desc.angularDeflection,
  })
  const positions = new Float32Array(mesh.positions)
  const indices = new Uint32Array(mesh.indices)
  shape.positions = positions
  shape.indices = indices
  const brepTess: BrepMeshResult = {
    positions,
    indices,
    normals: new Float32Array(mesh.normals),
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    ...(mesh.faceGroups ? { faceGroups: new Int32Array(mesh.faceGroups) } : {}),
    ...(mesh.faceCount !== undefined ? { faceCount: mesh.faceCount } : {}),
  }
  const shapeRec = shape as unknown as Record<symbol, unknown>
  shapeRec[BREP_TESS] = brepTess
  delete shapeRec[BREP_LAZY_TESS]
  // 基本体 defer 物化后补挂 faceRanges（eager 路径 primitives.ts 同款结构、同款
  // 面白名单；面序号契约见 Shape.faceRanges——setFaceColor 必须可用）。
  if (
    desc.primitiveOp !== undefined &&
    mesh.faceGroups !== undefined &&
    shape.faceRanges === undefined
  ) {
    const fg = mesh.faceGroups
    const faceRanges: NonNullable<Shape['faceRanges']> = []
    for (let f = 0; f * 3 + 2 < fg.length; f++) {
      faceRanges.push({ start: fg[f * 3] / 3, count: fg[f * 3 + 1] / 3 })
    }
    shape.faceRanges = faceRanges
  }
  return brepTess
}
