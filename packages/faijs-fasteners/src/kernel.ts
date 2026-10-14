/**
 * kernel.ts — 本包私有内核访问层（内核取用面收敛 2026-10-14 §3.1）。
 *
 * 红线：
 *  - 本包不 initOcctWasm()、不持有 kernel 单例——内核由 host 注入；未配置即抛错、
 *    禁止兜底。取内核的唯一出口是 `getBrepApi()`（L1 中立面），本包**不读**裸槽位
 *    `getBackends().kernel.*`（库分层门禁 `scripts/check-lib-layering.mjs` 第 4 条）。
 *  - 仅 occt 平台专属能力走 `getOcctKernel()`（见 primitives.ts 的 `ruledFace` /
 *    `draftPrismFace`）。这两条支路在库级声明里如实体现：本包 `faijs.lib.platform`
 *    是 `[]`（中立，多数零件在 brepkit 下照常可建），受影响的构形函数逐个标
 *    `fn.engines = ['occt']`。
 *  - 不 import occt-wasm / GearKernel（那是另一个第三方库的私有接口）。
 */

// 中立内核出口住在 SDK 入口（`@faicad/faijs/sdk`）——那是库作者的开发面
// （`docs/library-dev-guide.md` §1 的分工表）。主入口没有它，只有裸槽位 `getBackends`。
import { getBrepApi } from '@faicad/faijs/sdk'
import type { BrepEngineApi, BrepHandle, BrepVec3 } from '@faicad/faijs'

/**
 * Get the host-injected BREP kernel as the L1 neutral surface.
 *
 * 包内其余文件一律 import 本函数，不各自取内核。`getBrepApi()` 在无引擎时抛
 * engine-neutral 的错（`BREP engine API not available`），所以这里不再自造消息、
 * 也不返回 null 兜底。
 *
 * @returns host 注入的 L1 BREP 引擎面。
 * @throws when no BREP engine is registered — never silently falls back to null or a stub
 *         (aligned with `runtime-state.ts`).
 */
export function requireKernel(): BrepEngineApi {
  return getBrepApi()
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
