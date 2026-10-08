/**
 * api transform — 变换对象库函数（translate/rotate_euler/scale/scale3d）
 *
 * 平台分层（narrowing plan Phase 5，D11 + 2026-09-28 D 批降级）：
 * - `translate` / `scale`：**中立 op**（不再声明 `engines:['occt']`）。BREP 路径按引擎
 *   能力**静态定轨**（读与 dispatchPath 同源的能力集，非运行时探测）：
 *   - occt（声明 `translateWithHistory` / `scaleWithHistory`）→ 走 face-evolution.ts 的
 *     `translateWithHashEvolution` / `scaleWithHashEvolution` 权威面演化（历史路径），
 *     产 hash 面映射并传播 roleTable；
 *   - brepkit（未声明该二核函数，但裸 `kernel.translate` / `kernel.scale` 是真实现）→
 *     L1 `translateBrep` / `scaleBrep`：几何精确，**另加 identityHashEvolution**。
 *     变换不改变面数/顺序，恒等映射真实成立（非伪造）——挂恒等面演化并传播 roleTable，
 *     选面/命名在降级路径不丢（区别于 boolean/chamfer 这种毁面重造、严禁伪造的情形）。
 * - `rotate_euler` / `scale3d`：**中立 op**——内核无单次 WithHistory 可表达
 *   （任意欧拉+pivot / 非等比），走 `rotateBrep` / `scaleBrep` + identity 面演化
 *   （只用 L1，跨引擎一致，不声明 engines）。
 *
 * dispatchPath 静态判定 brep/mesh，
 * BREP 路径用 brepOf(input) 取输入实体、fromBrep 登记输出实体。
 *
 * 网格链（方案 2026-10-01 §4 Phase 4 / B3 批）：`mesh:` 实现分两支——**网格实体**
 * 走网格后端内核变换句柄（保持网格零件身份与近似拓扑），**裸网格**维持既有的顶点
 * 烘焙（manifold 链，无身份可言）。两支靠 `hasMeshSolid` 区分，不靠"能不能跑"试错。
 */

import type { Shape, Vec3 } from '../mesh/types'
// B3 correction (2026-10-06): no library-face cad aggregate — import the impl from its own module.
import * as meshTransform from '../mesh/transform'
import { translateBrep, rotateBrep, scaleBrep, solidToShape } from '../brep/brep-ops'
import {
  identityEvolution,
  identityHashEvolution,
  rotateWithHashEvolution,
  scaleWithHashEvolution,
  translateWithHashEvolution,
} from '../brep/face-evolution'
import type { HashEvolution } from '../brep/face-evolution'
import { getBrepApi } from '../brep/handle-bridge'
import { getBackends } from '../runtime-state'
import { engineCapabilitySet } from '../cad-runtime/backend-dispatch'
import { fromBrep, brepOf, inputRoleTable, hasMeshSolid } from '../shape'
import { propagateAllOrigins } from '../topology/naming/roles'
import type { RoleTable } from '../topology/naming/types'
import type { Provenance } from '../topology/naming/lineage'
import { defineOp } from '../sdk'
import { assertVec3, assertPositiveNumber } from './assert'
import { meshSolidBasicEntry, meshSolidProduct } from './internal/mesh-solid-op'
import type { BrepHandle } from '../brep/engine/types'

/**
 * Validate translate parameters: `offset` must be a vec3.
 * @param params - the raw translate operation parameters.
 */
export function assertTranslateParams(params: Record<string, unknown>): void {
  assertVec3(params.offset, 'translate.offset')
}

/**
 * Validate rotate_euler parameters: `angles` must be a vec3, and `pivot`
 * (if provided) must also be a vec3.
 * @param params - the raw rotate_euler operation parameters.
 */
export function assertRotateParams(params: Record<string, unknown>): void {
  assertVec3(params.angles, 'rotate_euler.angles')
  if (params.pivot !== undefined && params.pivot !== null) {
    assertVec3(params.pivot, 'rotate_euler.pivot')
  }
}

/**
 * Validate scale parameters (brepjs contract, §4.6 裁决 2): `factor` must be a
 * positive number (uniform). The non-uniform array form belongs to `scale3d` —
 * any `scale(p, { factor: [x,y,z] })` call throws an explicit `E_ARGS_FORM`
 * error pointing at `scale3d` (error hint ≠ compatibility).
 * @param params - the raw scale operation parameters.
 */
export function assertScaleParams(params: Record<string, unknown>): void {
  if (Array.isArray(params.factor)) {
    throw new Error(
      '[faijs/args] scale: E_ARGS_FORM: uniform scaling takes a single number ' +
      '(scale(p, s, { center? })). Non-uniform scaling uses scale3d(p, [x,y,z]).',
    )
  }
  assertPositiveNumber(params.factor, 'scale.factor')
}

/**
 * Validate scale3d parameters (P6: factor locked to Vec3): `factor` must be a
 * vec3. The uniform scalar form belongs to `scale` — any `scale3d(p, 2)` call
 * throws an explicit `E_ARGS_FORM` error pointing at `scale` (§4.6 裁决 2).
 * @param params - the raw scale3d operation parameters.
 */
export function assertScale3dParams(params: Record<string, unknown>): void {
  if (typeof params.factor === 'number') {
    throw new Error(
      '[faijs/args] scale3d: E_ARGS_FORM: factor must be a vec3 [x, y, z]. ' +
      'Uniform scaling now uses scale(p, 2) (§4.6 裁决 2).',
    )
  }
  assertVec3(params.factor, 'scale3d.factor')
}

/**
 * BREP 路径：变换 solid + 面演化 + roleTable 传播 + 三角化 + fromBrep 登记。
 *
 * 静态双轨：
 * - 引擎声明 `translateWithHistory` / `scaleWithHistory`（occt）→ 权威历史路径
 *   （`translateWithHashEvolution` / `scaleWithHashEvolution`），产内核给出的面映射 + roleTable。
 * - 引擎只声明裸方法（brepkit：裸 `translate`/`scale` 是真实现，但无 `*WithHistory`）→
 *   L1 裸调用 + identityHashEvolution。变换是刚体变换、面数/顺序保持不变，恒等映射
 *   **真实成立**（非伪造；由 brep/face-evolution.ordering.test.ts 钉住）——因此 brepkit
 *   降级路径保留恒等面演化与 roleTable 传播，选面/命名不因降级而丢失。
 * `rotate_euler` / `scale3d` 走 `rotateBrep` / `scaleBrep` + identity 面演化（既有语义，跨引擎中性）。
 * @param op - the transform operation name.
 * @param input - the input geometry.
 * @param params - the operation parameters.
 * @returns the transformed Shape.
 */
/**
 * 返回欧拉角中唯一非零分量的轴索引（0=X / 1=Y / 2=Z）；多轴同时非零或全零返回 -1。
 *
 * 单轴欧拉角可等价映射到内核单轴 `rotateWithHistory`（绕该轴、以 pivot 为轴上一点），
 * 从而拿到内核权威面演化；多轴欧拉角内核无单次 API 可表达，退回 identity。
 * @param angles - the euler angles in degrees (XYZ order).
 * @returns the single non-zero axis index, or -1.
 */
function singleNonZeroAxis(angles: Vec3): 0 | 1 | 2 | -1 {
  let idx = -1
  for (let i = 0; i < 3; i++) {
    if (Math.abs(angles[i]) > 1e-12) {
      if (idx !== -1) return -1
      idx = i
    }
  }
  return idx as 0 | 1 | 2 | -1
}

function transformBrep(op: string, input: Shape, params: Record<string, unknown>): Shape {
  // L1 面：translateBrep/rotateBrep/scaleBrep/identityHashEvolution 只用 L1（D12）。
  const kernel = getBrepApi()
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[api/transform] input is not BREP')

  // 静态双轨（无运行时 try-catch 回退——按引擎**声明**的能力集在执行前定轨）：
  // - occt（声明 *WithHistory）→ 权威历史路径（产内核面映射 + roleTable）。
  // - brepkit（裸 translate/scale 是真实现，无 *WithHistory）→ L1 裸调用 + identityHashEvolution。
  //   变换不改变面数/顺序，恒等映射真实成立（非伪造），故仍挂恒等面演化与 roleTable 传播。
  const caps = engineCapabilitySet(getBackends().config.brepCapabilities)
  const hasTranslateHistory = caps.has('translateWithHistory')
  const hasScaleHistory = caps.has('scaleWithHistory')
  const hasRotateHistory = caps.has('rotateWithHistory')

  let resultSolid: BrepHandle
  // 面演化（hash 键）：权威路径用内核映射，降级/中立路径用 identity 恒等映射。
  let historyEvolution: HashEvolution

  if (op === 'translate') {
    if (hasTranslateHistory) {
      // 权威映射：内核 translateWithHistory（1:1 全覆盖，实测见 evolution-bindings.test.ts）
      const r = translateWithHashEvolution(kernel, inputSolid, params.offset as Vec3)
      resultSolid = r.result
      historyEvolution = r.evolution
    } else {
      // brepkit 降级：L1 裸 translate（几何精确）+ identity（变换保面序，真实正确）。
      resultSolid = translateBrep(kernel, inputSolid, params.offset as Vec3)
      historyEvolution = identityHashEvolution(kernel, inputSolid, resultSolid)
    }
  } else if (op === 'scale') {
    if (hasScaleHistory) {
      // 权威映射：内核 scaleWithHistory（仅均匀 —— assertScaleParams 已保证 factor 是 number）
      const r = scaleWithHashEvolution(
        kernel,
        inputSolid,
        (params.center as Vec3 | undefined) ?? [0, 0, 0],
        params.factor as number,
      )
      resultSolid = r.result
      historyEvolution = r.evolution
    } else {
      // brepkit 降级：L1 裸 scale（几何精确）+ identity（变换保面序，真实正确）。
      const center = (params.center as Vec3 | undefined) ?? [0, 0, 0]
      resultSolid = scaleBrep(kernel, inputSolid, params.factor as number, center)
      historyEvolution = identityHashEvolution(kernel, inputSolid, resultSolid)
    }
  } else if (op === 'rotate_euler') {
    // 单轴欧拉角可映射到内核单轴 rotateWithHistory → 权威面演化；
    // 多轴欧拉角内核无对应 API → L1 rotate + identity（ordering.test.ts 钉住）。
    const angles = params.angles as Vec3
    const axisIdx = singleNonZeroAxis(angles)
    if (hasRotateHistory && axisIdx !== -1) {
      const axis: Vec3 = axisIdx === 0 ? [1, 0, 0] : axisIdx === 1 ? [0, 1, 0] : [0, 0, 1]
      const pivot = (params.pivot as Vec3 | undefined) ?? [0, 0, 0]
      const r = rotateWithHashEvolution(kernel, inputSolid, pivot, axis, (angles[axisIdx] * Math.PI) / 180)
      resultSolid = r.result
      historyEvolution = r.evolution
    } else {
      resultSolid = rotateBrep(kernel, inputSolid, angles, params.pivot as Vec3 | undefined)
      historyEvolution = identityHashEvolution(kernel, inputSolid, resultSolid)
    }
  } else {
    // scale3d（非等比）：内核无单次 WithHistory 可表达 →
    // L1 scale + identity 面演化（face-evolution.ordering.test.ts 钉住）。
    resultSolid = scaleBrep(kernel, inputSolid, params.factor as number | Vec3, params.center as Vec3 | undefined)
    historyEvolution = identityHashEvolution(kernel, inputSolid, resultSolid)
  }

  // 变换面 1:1 保留——沿演化传播 roleTable（所有 origin），跨引擎一致（含 brepkit 降级路径）。
  const inputTable = inputRoleTable(input) as RoleTable | undefined
  let roleTable: RoleTable | undefined
  if (inputTable && inputTable.size > 0) {
    roleTable = propagateAllOrigins(inputTable, historyEvolution)
  }

  return fromBrep(solidToShape(kernel, resultSolid), {
    solid: resultSolid,
    // 变换维护拓扑，面 ordinal 不变 → 挂 identity 面演化（供显示/选面，跨引擎一致）。
    faceEvolution: identityEvolution(kernel, resultSolid),
    roleTable,
  })
}

/**
 * 网格实体路径：把同一个变换应用到网格实体的**句柄**上（方案 2026-10-01 §4 Phase 4 / B3 批）。
 *
 * 为什么不复用 `cad.translate` 那套顶点烘焙：那套只动 `positions`、不碰身份槽——
 * 对一个网格零件用它，等于把"网格实体 + 近似拓扑"静默降级成"裸网格"（下游每一个
 * 网格 op 都会因此失去选面/选边的能力）。网格链的正确姿势与 BREP 侧完全一致：
 * **变换句柄**（内核 `translate`/`transform` 带 kind tag 返回新实体），再由
 * `meshSolidProduct` 重新三角化 + 重建近似拓扑。
 *
 * 面演化在这里**如实缺席**：变换按定义 1:1 保面序，但没有 hash 演化可言（近似拓扑
 * 没有内核 hash）——不造恒等映射，也不传播 roleTable（网格链上没有 roleTable）。
 *
 * @param op - the transform operation name.
 * @param input - the mesh-solid input.
 * @param params - the validated operation parameters.
 * @returns the transformed mesh solid as a new mesh part.
 */
function transformMeshSolid(op: string, input: Shape, params: Record<string, unknown>): Shape {
  const entry = meshSolidBasicEntry(input, op)
  let result: BrepHandle
  if (op === 'translate') {
    result = translateBrep(entry.kernel, entry.solid, params.offset as Vec3)
  } else if (op === 'rotate_euler') {
    result = rotateBrep(entry.kernel, entry.solid, params.angles as Vec3, params.pivot as Vec3 | undefined)
  } else if (op === 'scale') {
    result = scaleBrep(entry.kernel, entry.solid, params.factor as number, params.center as Vec3 | undefined)
  } else {
    result = scaleBrep(entry.kernel, entry.solid, params.factor as Vec3, params.center as Vec3 | undefined)
  }
  return meshSolidProduct(entry, result)
}

/**
 * 平移几何体。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name translate
 * @deprecated **`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
 * @returns Shape 平移后的几何，装配的相对位置靠成员的变换语句表达。
 * @param input - 目标几何。type:Shape required:true
 * @param params.offset - 平移向量（mm）。type:[x,y,z] required:true
 * @example
 * const p1 = cad.translate(part0, { offset: [10, 0, 0] })
  */
export const translate = defineOp({
  name: 'translate',
  meshEngines: ['brepkit'],
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/translate] no input geometry')
    assertTranslateParams(params)
    if (hasMeshSolid(input)) return transformMeshSolid('translate', input, params)
    return meshTransform.translate(input, params.offset as Vec3)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/translate] no input geometry')
    assertTranslateParams(params)
    return transformBrep('translate', input, params)
  },
  // D11: `translate(p, 10, 0, 0)` == `translate(p, { offset: [10, 0, 0] })`;
  // `offset` is a vec3 slot sitting after the single leading Shape argument.
  slotMap: { keys: ['offset'], vec3Keys: ['offset'], shapeArity: 1 },
  paramDims: { offset: 'length' },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})

/**
 * 绕轴旋转几何体。angles 为欧拉角（度，XYZ 顺序）。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name rotate_euler
 * @deprecated **`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
 * @returns Shape 旋转后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.angles - 欧拉角（度，XYZ 顺序）。type:[x,y,z] required:true
 * @param params.pivot - 旋转中心。type:[x,y,z] 默认 原点
 * @example
 * const p2 = cad.rotate_euler(part0, { angles: [0, 0, 45] })
 * const p3 = cad.rotate_euler(part0, { angles: [0, 0, 45], pivot: [0,0,0] })
 */
export const rotate_euler = defineOp({
  name: 'rotate_euler',
  meshEngines: ['brepkit'],
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/rotate_euler] no input geometry')
    assertRotateParams(params)
    if (hasMeshSolid(input)) return transformMeshSolid('rotate_euler', input, params)
    return meshTransform.rotate_euler(input, params.angles as Vec3, params.pivot as Vec3 | undefined)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/rotate_euler] no input geometry')
    assertRotateParams(params)
    return transformBrep('rotate_euler', input, params)
  },
  // D11: `rotate_euler(p, 0, 0, 45)` == `rotate_euler(p, { angles: [0, 0, 45] })`.
  slotMap: { keys: ['angles'], vec3Keys: ['angles'], shapeArity: 1 },
  paramDims: { angles: 'angle', pivot: 'length' },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})

/**
 * 等比缩放几何体（brepjs 契约，§4.6 裁决 2）。factor 只收 number；不动点默认
 * 原点（与旧 `scale(shape, factor, { center? })` 一致），`center` 可选。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name scale
 * @deprecated **`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
 * @returns Shape 缩放后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.factor - 等比缩放系数（> 0）。type:number required:true
 * @param params.center - 缩放不动点（p 保持不动）。type:[x,y,z] 默认 [0,0,0]（原点）
 * @example
 * const p4 = cad.scale(part0, 2)
 * const p5 = cad.scale(part0, { factor: 2, center: [10, 0, 0] })
 */
export const scale = defineOp({
  name: 'scale',
  meshEngines: ['brepkit'],
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/scale] no input geometry')
    assertScaleParams(params)
    if (hasMeshSolid(input)) return transformMeshSolid('scale', input, params)
    return meshTransform.scale(input, params.factor as number, params.center as Vec3 | undefined)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/scale] no input geometry')
    assertScaleParams(params)
    return transformBrep('scale', input, params)
  },
  // L3 schema: factor/center for codegen/UI panels.
  schema: { factor: 'number', center: 'vec3?' },
  // D11（§4.6）：`scale(p, 2)` == `scale(p, { factor: 2 })`（标量槽）；尾参 options
  // （{center}）经 dual-form-args 尾参合并并入。
  slotMap: { keys: ['factor'], shapeArity: 1 },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})

/**
 * 非等比缩放几何体（faijs 语义，§1.4.4 裁决 2）。factor 定死 vec3 — 等比缩放请用
 * `scale(p, s)`，`scale3d(p, [x,y,z])` 才可非等比。`center` 为不动点（默认原点）。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name scale3d
 * @deprecated **`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
 * @returns Shape 缩放后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.factor - 三轴缩放系数（均 > 0）。type:[x,y,z] required:true
 * @param params.center - 缩放不动点。type:[x,y,z] 默认 [0,0,0]（原点）
 * @example
 * const p4 = cad.scale3d(part0, { factor: [2, 1, 1] })
 * const p5 = cad.scale3d(part0, [2, 1, 1], { center: [10, 0, 0] })
 */
export const scale3d = defineOp({
  name: 'scale3d',
  meshEngines: ['brepkit'],
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/scale3d] no input geometry')
    assertScale3dParams(params)
    if (hasMeshSolid(input)) return transformMeshSolid('scale3d', input, params)
    return meshTransform.scale3d(input, params.factor as Vec3, params.center as Vec3 | undefined)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/scale3d] no input geometry')
    assertScale3dParams(params)
    return transformBrep('scale3d', input, params)
  },
  // L3 schema: factor/center for codegen/UI panels.
  schema: { factor: 'vec3', center: 'vec3?' },
  // D11（裁决 2）：`scale3d(p, [1,2,3])` == `scale3d(p, { factor: [1,2,3] })`；
  // 标量 factor（如 `scale(p, 2)`）由 assertScale3dParams 拒绝并提示 `scale`。
  slotMap: { keys: ['factor'], vec3Keys: ['factor'], shapeArity: 1 },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
