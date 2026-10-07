/**
 * api halfSpace — 无限半空间实体（平台 op engines:['occt']）
 *
 * @platform occt — 实现直调 occt 原生 `halfSpace(origin, normal)`（occt-wasm 有，
 * L1 契约 `brep/engine/primitives.ts` 无对应成员）⇒ 平台 op：defineOp 声明
 * `engines: ['occt']`（D11）。守卫 ① 要求平台 import 自证身份（本头注）；调用方
 * op 声明 `engines` 由守卫 ② 校验。
 *
 * 产物形态（实测，见 `test/api/occt-s3-capability-probes.test.ts` 的 A/B/C 三例）：
 * 半空间是**无界实体**——它有有限的面（一张平面）+ 无界的「其余边界」，三角化
 * 后**面载荷为空**（`positions.length === 0`），这是该几何的真值，不是失败。
 * 它唯一的用途是**作无界布尔工具**：
 *   `kernel.cut(makeBox(10,10,10), halfSpace({z:5},{z:1}))` → 体积 500、z ∈ [0,5]。
 *
 * 因此在脚本面它是「布尔工具发生器」：`cad.cut(part0, cad.halfSpace(...))`。
 * 单独渲染它没有意义（空 mesh），单独导出 STEP 会得到无界体。
 *
 * 血缘：半空间没有面角色词汇（其面不来自任何输入面）⇒ `naming: unmodeled` + reason
 * （方案 §4.2 表列此项）。
 *
 * 与既有 op 的边界（方案 §4.5 去重表）：`sectionByPlane` / `splitByPlane` 是**以平面
 * 切割/求交**的中立 op；`halfSpace` 产**实体**、不作切割动作，二者不可互替——
 * `halfSpace` 可喂给 `cut` / `common` / `split` 的任意工具位（包含 split 工具位）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle, BrepVec3 } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getOcctKernel } from '../occt-kernel/occtKernel'

type Vec3 = [number, number, number]

/** `cad.halfSpace` 参数。 */
export interface HalfSpaceParams {
  /** 边界平面上的一点 `[x, y, z]`（mm）。半空间从该平面沿 `normal` 方向张开。 */
  origin: Vec3
  /** 边界平面法向 `[x, y, z]`（不必单位化；零向量非法）。保留侧 = 法向所指一侧。 */
  normal: Vec3
}

/** 元组 → BrepVec3 对象（同 sectionByPlane：L1/原生向量形参是 {x,y,z} 对象）。 */
function toVec3(v: Vec3, which: 'origin' | 'normal'): BrepVec3 {
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    v.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  ) {
    throw new Error(`E_HALF_SPACE_BAD_${which.toUpperCase()}: ${which} must be [x,y,z] finite numbers`)
  }
  if (which === 'normal' && v[0] === 0 && v[1] === 0 && v[2] === 0) {
    throw new Error('E_HALF_SPACE_BAD_NORMAL: normal must be a non-zero vector (it defines the plane)')
  }
  return { x: v[0], y: v[1], z: v[2] }
}

/** BREP 路径：occt 原生 halfSpace → 无界实体（空 mesh）经 fromBrep 收养句柄。 */
function halfSpaceBrep(params: HalfSpaceParams): Shape {
  const { origin, normal } = params ?? ({} as HalfSpaceParams)
  const o = toVec3(origin, 'origin')
  const n = toVec3(normal, 'normal')
  const kernel = getBrepApi()
  // 实测（探针 A）：无限半空间可被 `meshShape` 三角化，不抛错，产出空面载荷。
  const handle = getOcctKernel().halfSpace(o, n) as unknown as BrepHandle
  return fromBrep(solidToShape(kernel, handle), { solid: handle }) as Shape
}

/**
 * 构造无限半空间实体（无界布尔工具）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name halfSpace
 * @note 平台 op：仅 occt 引擎（原生 halfSpace，L1 契约无对应成员）。非 occt 引擎
 *       执行前报错；brep_mock 不拦截。产物是**无界实体**：面载荷为空（无有限面可
 *       离散），单独渲染无意义，用法是喂给布尔 op 作工具
 *       （`cad.cut(part0, cad.halfSpace({ origin: [0,0,5], normal: [0,0,1] }))` 切出 z<=5 的一半）。
 * @returns Shape 无限半空间实体（brep 句柄有效、mesh 为空）。
 * @param params.origin - 边界平面上一点 [x,y,z]（mm）。type:Vec3 required:true
 * @param params.normal - 边界平面法向 [x,y,z]（非零；保留侧 = 法向所指侧）。type:Vec3 required:true
 * @example
 * const half = cad.halfSpace({ origin: [0, 0, 5], normal: [0, 0, 1] })
 * const lower = cad.cut(part0, half)
 */
export const halfSpace = defineOp({
  name: 'halfSpace',
  paramDims: { 'params.origin': 'length', 'params.normal': 'length' },
  brep(params: HalfSpaceParams) {
    return halfSpaceBrep(params)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'unbounded half-space has no source-derived face role vocabulary',
  } as Provenance,
})
