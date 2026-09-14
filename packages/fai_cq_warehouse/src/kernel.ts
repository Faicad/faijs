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

import { getBackends } from '@faicad/faijs-core'
import type { BrepEngineApi, BrepHandle, BrepVec3 } from '@faicad/faijs-core'

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
 * WarehouseKernel extends BrepEngineApi — 只声明本包真正用到的成员
 * （方案 §5.5.2 第 ② 层：结构性匹配，不 import occt-wasm）。
 *
 * ⚠️ 关键认知：这一层是「我认为应该有」的**声明**，不是证明——它只换来
 * 编辑器补全，不提供任何正确性保证。正确性由 kernel-conformance.test.ts
 * （第 ③ 层，两级断言：存在性 + 契约 smoke）兜住；新增成员必须先加进
 * 该测试的清单（§10 内核契约门禁）。
 */
export interface WarehouseKernel extends BrepEngineApi {
  // ── 构造原语（W3 thread / W4 nut knurl / W6 bearing 依赖）──
  /** cq `Wire.makeHelix` 等价：**右手**圆柱螺旋线。
   *  ⚠️ 实测（occtWasmAdapter:430）：raw wasm 仅 9 参，无 taper/lefthand——
   *  锥螺旋上游 5 类用不到（taper 默认 360°=圆柱）；左手螺纹由调用方镜像实现。 */
  makeHelixWire(origin: BrepVec3, axis: BrepVec3, pitch: number, height: number, radius: number): BrepHandle
  /** 点列 → 逼近 B 样条曲线（thread 端部 fade 的参数曲线，cq parametricCurve 等价）。 */
  approximatePoints(points: BrepVec3[], tolerance?: number): BrepHandle
  /** 点阵 → B 样条曲面 → Face（齿廓/螺纹曲面逼近）。 */
  bsplineSurface(points: BrepVec3[], rows: number, cols: number): BrepHandle
  /** `BRepBuilderAPI_Sewing`：faces → shell（thread 的 make_shell 步骤）。 */
  sew(shapes: BrepHandle[], tolerance?: number): BrepHandle
  /** shell → solid（thread 的 make_solid 步骤）。 */
  makeSolid(shell: BrepHandle): BrepHandle
  /** face/wire 绕轴旋转扫掠（nut/screw/bearing 的 revolve 轮廓）。 */
  revolve(shape: BrepHandle, axis: WarehouseAxis, angleRad: number): BrepHandle
  /** 退化为厚度的面拉伸（fastener knurl 面；makeNSidedSurface 缺失期的路径之一）。 */
  thicken(shape: BrepHandle, thickness: number, tolerance: number): BrepHandle
  /** 非平面 wire → face（HeatSetNut knurl，kernel 层原语——注意与
   *  extensions.py 的 Workplane 级 makeNonPlanarFace 封装是两个层，§3.4）。 */
  makeNonPlanarFace(wire: BrepHandle): BrepHandle

  // ── 朝向（thread 的缝合实体定向）──
  /** 反转 shape 的朝向。实测：2×2×2 box 体积 8 → -8，即 getVolume 随之变号；
   *  用于把 sew 得到的反向实体翻正（`primitives.orientOutward`）。 */
  reverseShape(shape: BrepHandle): BrepHandle

  // ── 查询（度量自检 / conformance smoke）──
  getSurfaceArea(shape: BrepHandle): number
  /** 三角化（mesh 体积基准）。A 侧 `Shape.tessellate(tol, angular=0.1)` 的等价物。
   *  ⚠️ 与 core `getVolume`（BRepGProp 精确曲面积分）并存不是冗余：后者对螺旋
   *  B 样条面存在**求积混叠**（A 侧 Thread raw/raw 差 14%），三角化才是真值基准。
   *  ⚠️ `tessellate` 会**原地**给 shape 建三角化，之后的 `getBoundingBox` 若按
   *  `useTriangulation=true` 取盒会被污染（A 侧 manifest 已因此错 0.0126 mm）——
   *  先量 bbox 再三角化。 */
  tessellate(shape: BrepHandle, options?: TessellateOptionsLite): TessellateResultLite
}

/** `tessellate` 参数（结构性声明，不 import occt-wasm）。 */
export interface TessellateOptionsLite {
  linearDeflection?: number
  angularDeflection?: number
  relative?: boolean
}

/** `tessellate` 返回值的最小结构面。 */
export interface TessellateResultLite {
  positions: Float32Array
  indices: Uint32Array
  vertexCount: number
  triangleCount: number
}
