/**
 * kernel.ts — 本包私有 raw 内核访问层（方案 §5.5.2 第 ①② 层）。
 *
 * 红线（§5.1 约束 2/3）：
 *  - 本包不 initOcctWasm()、不持有 kernel 单例——内核由 host 经
 *    getBackends().kernel.brep 注入；未配置即抛错、禁止兜底。
 *  - 全包**只有本文件**调 getBackends()；其余文件一律 import { requireKernel }。
 *    将来 core 的 KernelBase backlog（§5.5.1 / D3）修复后只需改这里 1 行。
 *  - 不 import occt-wasm / GearKernel（那是另一个第三方库的私有接口）。
 */

import { getBackends } from '@faicad/faijs'
import type { BrepEngineApi, BrepHandle, BrepVec3 } from '@faicad/faijs'

/**
 * Get the BREP kernel injected by the host.
 * 与 core 自身消费点同构（`core/src/api/*.ts` 等 19 处同一模式）。
 * @throws when the kernel is absent — never silently falls back to null or a stub
 *         (aligned with `runtime-state.ts:364-368`).
 * @returns host 注入的 BREP 引擎 API。
 */
export function requireKernel(): BrepEngineApi {
  const k = getBackends().kernel.brep as BrepEngineApi | null
  if (!k)
    throw new Error(
      '[fai-cq-warehouse] BREP kernel unavailable: call configureBackends({ kernel: { brep } }) first',
    )
  return k
}

/** Rotation axis (point + direction), mirroring cq `Workplane` axis semantics. */
export interface WarehouseAxis {
  point: BrepVec3
  direction: BrepVec3
}

/**
 * WarehouseKernel — `BrepEngineApi` 的**真子集** + occt 平台面补声明。
 *
 * 2026-10-13 收敛（方案 2026-10-13-brepkit-l1-spline-primitive-wiring-plan §5.1）：
 * 原先「`Omit<BrepEngineApi, …>` + 19 个私有扩展重声明」的形态已不需要——
 * 样条/螺旋族（`makeHelixWire` / `approximatePoints` / `bsplineSurface` /
 * `makeSolid` / `thicken` / `makeNonPlanarFace` / `rotate` /
 * `interpolatePointsWithTangents`）全部进了 L1，直接继承；包内调用点同步改名：
 *   `revolve` → `revolveVec`（角度**度**，包内自行换算）、
 *   `tessellate` → `meshShape`、
 *   `loft(wires, isSolid, ruled)` → `loft(sections, ruled)`。
 *
 * 剩下**不在** L1 的只有 brepkit 侧确实没有 / 同名不同义的 occt 平台能力（C 类），
 * 它们在包内经 `getOcctKernel()` 取用，不在本类型里声明：
 *   · `draftPrism`（taper 沉孔切割器；brepkit 无）
 *   · `loft(wires, isSolid=false, ruled)`（`ruledFace` 要的是开放曲线间的**单张
 *     直纹面**，而 L1 loft 恒建实体 —— 语义不同，不能换成 L1）
 *
 * ⚠️ 关键认知：这一层是「我认为应该有」的**声明**，不是证明——它只换来
 * 编辑器补全，不提供任何正确性保证。正确性由 kernel-conformance.test.ts
 * （第 ③ 层，两级断言：存在性 + 契约 smoke）兜住；新增成员必须先加进
 * 该测试的清单（§10 内核契约门禁）。
 */
export type WarehouseKernel = Omit<BrepEngineApi, 'getNurbsCurveData'> & {
  /** NURBS 曲线数据（探针取极点对表用，如 PanHead 样条 vs `GeomAPI_Interpolate`）。
   *  ⚠️ 平台契约 `BrepEngineApi.getNurbsCurveData` 只声明了
   *  `{degree, periodic, rational}`（core 的类型欠账，已记 backlog）；
   *  occt-wasm 实际还返回 `knots / multiplicities / poles / weights`——
   *  本包按**真实返回结构**补声明（结构性匹配，不 import occt-wasm），
   *  探针断言依赖它。 */
  getNurbsCurveData(edge: BrepHandle): NurbsCurveDataLite | null
}

/** occt-wasm `NurbsCurveData` 中本包用到的字段（平台契约未声明，见 {@link WarehouseKernel}）。 */
export interface NurbsCurveDataLite {
  degree: number
  periodic: boolean
  rational: boolean
  knots: number[]
  multiplicities: number[]
  poles: number[]
  weights: number[]
}

/** `meshShape` 参数（结构性声明，不 import occt-wasm）。 */
export interface TessellateOptionsLite {
  linearDeflection?: number
  angularDeflection?: number
  relative?: boolean
}

/** `meshShape` 返回值中本包用到的最小结构面。 */
export interface TessellateResultLite {
  positions: Float32Array
  indices: Uint32Array
  vertexCount: number
  triangleCount: number
}
