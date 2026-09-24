/**
 * stdlib draft — 拔模：对选定面施加拔模斜度（手写**平台** op，Phase 5）
 *
 * `engines: ['occt']` —— 但**不是平台依赖**（实现只经 L1 契约面 `getBrepApi()`，
 * 见下选面口径），而是**实证收窄**：brepkit 的 L1 `draft` 实测产出错误几何，
 * 必须让静态门在执行前拒绝（红线：BREP 链可用性执行前静态判定，不允许
 * 「门说能、内核说不能」；也不允许静默产出错几何）。
 *
 * 实证（同脚本、box(20,20,10)、angleDeg=3，两引擎同一次运行）：
 * - occt：4 个侧面（faceRef ordinal 1–4）**都给一致 delta = −52.4078**
 *   —— 对称输入 ⇒ 对称输出，几何自洽；⊥ pull 的端面由内核报 KERNEL_ERROR。
 * - brepkit：ordinal 1–5 给 +60.29 / 0 / 0 / +17.47 / 0 —— **对称性被破坏**
 *   （对称 box 上对单个侧面拔模，四个侧面不可能给出不同结果），其中三个是
 *   **静默无操作**（体积与 bbox 均不变），而 ⊥ pull 的端面反而把 x/y 凸包各撑大
 *   0.524（= 10·tan 3°）。序号错配不能解释：破坏对称性与序号无关。
 *
 * 选面口径（设计原则 4）：`faces: FaceTopoRef[]`（`cad.faceRef` 产物）。
 * `neutral` 用 `{point, normal}` 平面参数——不给 face 引用（方案 §7 建议 2）。
 *
 * 回归守卫：`api/feature-family.test.ts` 的「brepkit 下 draft 静态拒绝」用例。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle, BrepVec3 } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { FaceTopoRef } from '../topology/naming'
import { resolveTopoRef, TopoRefError } from '../topology/naming'
import type { Provenance } from '../topology/naming/lineage'
import { buildEdgeResolutionContext } from './topo-resolve'

type Vec3 = [number, number, number]

/** `cad.draft` 参数。 */
export interface DraftParams {
  /** 拔模面（FaceTopoRef[]，`cad.faceRef` 产物）。 */
  faces: FaceTopoRef[]
  /** 拔模角（度）。 */
  angleDeg: number
  /** 拔模方向（默认 +Z）。 */
  pull?: Vec3
  /**
   * 中性平面：**只有点的语义**（内核把该点所在高度视为 0° 基准；省略取原点）。
   * `normal` 无任何内核消费者（occt-wasm 原生 `draft` 无 neutral 形参，brepkit
   * 只收点），传了会显式报 `E_DRAFT_NEUTRAL_NORMAL_UNUSED`。
   */
  neutral?: { point: Vec3; normal?: Vec3 }
}

/** BREP 路径：解析面引用 → L1 draft → 收养。 */
function draftBrep(input: Shape, params: DraftParams): Shape {
  const { faces, angleDeg } = params ?? ({} as DraftParams)
  if (!Array.isArray(faces) || faces.length === 0) {
    throw new Error('E_DRAFT_NO_FACES: draft requires at least one FaceTopoRef in faces')
  }
  if (typeof angleDeg !== 'number' || !Number.isFinite(angleDeg) || angleDeg === 0) {
    throw new Error('E_DRAFT_BAD_ANGLE: draft.angleDeg must be a non-zero number (degrees)')
  }
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('E_DRAFT_NO_BREP: draft input is not BREP')

  const ctx = buildEdgeResolutionContext(kernel, input as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'draft: input has no BREP naming context')
  const faceHandles = faces.map((ref) => {
    if (!ref || (ref as { kind?: unknown }).kind !== 'face') {
      throw new Error('E_DRAFT_BAD_FACE_REF: every faces entry must be a FaceTopoRef (cad.faceRef)')
    }
    const r = resolveTopoRef(ref, ctx)
    if (r.handle === undefined) {
      throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `draft: face resolved without handle (${ref.origin}/${ref.role})`)
    }
    return r.handle as BrepHandle
  })

  // GOTCHA-1（Phase 5 实测）：L1 的向量形参是 `BrepVec3 = {x,y,z}` **对象**，不是元组。
  // 传 `[0,0,1]` 会被内核读成零向量 ⇒ occt 抛空文案 KERNEL_ERROR、brepkit 抛
  // "cannot normalize zero vector"，两边都不可用。必须显式转对象（同 pattern.ts:41）。
  const [px, py, pz] = params.pull ?? [0, 0, 1]
  const pullVec: BrepVec3 = { x: px, y: py, z: pz }

  // 中性面缺省：中性点取原点（内核语义为「该点处角度为 0」）。
  const nPoint = params.neutral?.point
  const neutralVec: BrepVec3 = nPoint
    ? { x: nPoint[0], y: nPoint[1], z: nPoint[2] }
    : { x: 0, y: 0, z: 0 }

  // GOTCHA-2（Phase 5 实测）：L1 draft 的 neutral 只有**点**语义（occt-wasm 原生
  // `draft(shape, face, angleRad, direction)` 根本没有 neutral 形参，brepkit 也只收
  // 点：brepkitKernel.ts:669-676）。故 `neutral.normal` 无任何消费者——按项目约定
  // （occt-primitives.ts interpolatePoints「拒绝而非静默产出错几何」）显式报错，
  // 不静默丢弃。
  if (params.neutral?.normal) {
    throw new Error(
      'E_DRAFT_NEUTRAL_NORMAL_UNUSED: L1 draft takes a neutral POINT only (no plane normal) — ' +
        'drop neutral.normal, or model the plane via pull + a point on it',
    )
  }

  const result = kernel.draft(solid, faceHandles, pullVec, neutralVec, angleDeg)
  return fromBrep(solidToShape(kernel, result), { solid: result })
}

/**
 * 拔模：对选定面施加拔模斜度（铸造/注塑出模角）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name draft
 * @note **occt-only**（`engines: ['occt']`；实证收窄，非平台依赖——见文件头实证：
 *       brepkit 破坏对称性且部分 ordinal 静默无操作）。`neutral`（中性点）**只支持
 *       原点**：occt-wasm 原生 `draft(shape, face, angleRad, direction)` 没有 neutral
 *       形参，传非原点中性点会显式报错（不静默产出错几何）；brepkit 已被静态拒绝，
 *       故非原点 `neutral` 当前**没有任何可用引擎**——需要该语义时请改用
 *       `pull` + 面上一点建模。仅 BREP 可用（mesh 输入执行前报错）。
 * @returns Shape 拔模后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.faces - 拔模面（FaceTopoRef[]，cad.faceRef 产物）。type:FaceTopoRef[] required:true
 * @param params.angleDeg - 拔模角（度，≠0）。type:number required:true
 * @param params.pull - 拔模方向（默认 +Z）。type:Vec3 required:false
 * @param params.neutral - 中性面**点**（{point}；normal 无消费者）。type:{point:Vec3,normal?:Vec3} required:false
 * @example
 * const d = await cad.draft(part0, { faces: [cad.faceRef(part0, 3)], angleDeg: 3 })
 */
export const draft = defineOp({
  capabilities: ['directEdit'],
  // 实证收窄（2026-09-24）：brepkit 的 L1 draft 产出错误几何（破坏对称性 / 静默无操作），
  // 声明 occt 白名单让静态门在执行前拒绝 —— 与 capabilities 并存合法（两条正交轴，
  // engines 先判、能力门在引擎匹配后再求交）。
  engines: ['occt'],
  brep(input: Shape, params: DraftParams) {
    return draftBrep(input, params)
  },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
