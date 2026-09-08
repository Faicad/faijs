/**
 * kernel — faijs BREP 内核访问 + occt-wasm 原始能力面
 *
 * ## 为什么需要「原始内核面」
 *
 * faijs 对库作者暴露的 `BrepEngineApi`（`initOcctWasm()` 的声明返回类型）是**中立契约面**，
 * 只覆盖 faijs 自己用到的那部分内核能力。cq_gears 移植需要的两个关键构造不在其中：
 *
 * - `bsplineSurface(points, rows, cols)` — CadQuery `Face.makeSplineApprox` 的
 *   唯一等价物（内部即 `GeomAPI_PointsToBSplineSurface`）。
 * - `approximatePoints / interpolatePoints` — 曲线级 B-spline 构造（行-放样路线的原料）。
 *
 * 硬约束（2026-09-08 实测）：`occt-wasm` 是**预编译 wasm + JS 绑定**
 * （`node_modules/occt-wasm/dist`），仓库里没有 C++ 源码，**不可能给内核加方法**。
 * 因此只能在既有绑定之上组合——本文件就是那条边界：
 *
 * 1. `initOcctWasm()` 返回的对象运行时**就是** occt-wasm 的 `OcctKernel` 实例；
 * 2. 这里把它断言成 `RawOcctKernel`（`BrepEngineApi` 的超集），从而拿到原始能力；
 * 3. `assertRawKernel()` 在测试里逐个断言这些方法是函数——**内核升级/绑定改名会立刻变红**，
 *    不会变成运行时的 `undefined is not a function`。
 *
 * ⚠️ 句柄不能跨内核实例：`ShapeHandle`/`BrepHandle` 是该实例 arena 的下标，
 *    所以本包**必须**用 faijs 那一个实例，绝不自己 new 一个 `OcctKernel`。
 */

import { initOcctWasm } from '@faicad/faijs-core'
import type { BrepEngineApi, BrepHandle, BrepVec3 } from '@faicad/faijs-core'

/** 旋转/镜像轴（occt-wasm 的形态）。 */
export interface RawAxis {
  point: BrepVec3
  direction: BrepVec3
}

/**
 * occt-wasm 原始能力面——`BrepEngineApi` 的超集。
 *
 * 只声明 cq_gears 移植真正用到的方法；新增用法请先在这里补声明并跑
 * `kernel-probe.test.ts`。
 */
export interface RawOcctKernel extends BrepEngineApi {
  // ── 曲面 / 曲线构造（CadQuery makeSplineApprox 的等价物族）──
  /** `GeomAPI_PointsToBSplineSurface`：点阵 → B-spline 曲面 → Face。 */
  bsplineSurface(points: BrepVec3[], rows: number, cols: number): BrepHandle
  /** `GeomAPI_PointsToBSpline`：点列 → B-spline 近似曲线（带 Tol3D）。 */
  approximatePoints(points: BrepVec3[], tolerance?: number): BrepHandle
  /** 过所有点的三次 B-spline 插值曲线。 */
  interpolatePoints(points: BrepVec3[], periodic?: boolean): BrepHandle

  // ── 拓扑构造 ──
  /** `BRepBuilderAPI_Sewing`：面 → 缝合壳（cq `make_shell` 的等价物，带 tol）。 */
  sew(shapes: BrepHandle[], tolerance?: number): BrepHandle
  makeSolid(shell: BrepHandle): BrepHandle
  /** TopAbs_ShapeEnum type name ("solid" / "shell" / "face" …, for diagnostics/assertions). */
  getShapeType(shape: BrepHandle): string
  buildSolidFromFaces(faces: BrepHandle[], tolerance?: number): BrepHandle
  makeNonPlanarFace(wire: BrepHandle): BrepHandle
  makeFaceOnSurface(face: BrepHandle, wire: BrepHandle): BrepHandle
  outerWire(face: BrepHandle): BrepHandle

  // ── 修复 ──
  healWire(wire: BrepHandle, tolerance?: number): BrepHandle
  healFace(face: BrepHandle, tolerance?: number): BrepHandle

  // ── 变换 / 布尔 ──
  rotate(shape: BrepHandle, axis: RawAxis, angleRad: number): BrepHandle
  mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle
  reverseShape(shape: BrepHandle): BrepHandle
  vertexPosition(vertex: BrepHandle): BrepVec3
  split(shape: BrepHandle, tools: BrepHandle[]): BrepHandle
  fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle
  shell(
    solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, tolerance: number,
  ): BrepHandle
  thicken(shape: BrepHandle, thickness: number, tolerance: number): BrepHandle
  makeCircleArc(
    center: BrepVec3, normal: BrepVec3, radius: number, startAngle: number, endAngle: number,
  ): BrepHandle
  makeHelixWire(
    origin: BrepVec3, axis: BrepVec3, pitch: number, height: number, radius: number,
  ): BrepHandle

  // ── 查询 ──
  getSurfaceArea(shape: BrepHandle): number
  projectPointOnFace(face: BrepHandle, point: BrepVec3): BrepVec3
  surfaceType(face: BrepHandle): string
  subShapeCount(shape: BrepHandle, type: 'vertex' | 'edge' | 'wire' | 'face' | 'shell' | 'solid'): number
  isFace(shape: BrepHandle): boolean
  isWire(shape: BrepHandle): boolean
  isShell(shape: BrepHandle): boolean
  isEdge(shape: BrepHandle): boolean
}

/**
 * 内核探针断言用到的方法名清单。
 *
 * 这是一份**契约**：`RawOcctKernel` 里每新增一个方法，都要同步加到这里，
 * 由 `kernel-probe.test.ts` 在真实内核上验证存在性。
 */
export const RAW_KERNEL_METHODS: ReadonlyArray<keyof RawOcctKernel> = [
  'bsplineSurface',
  'approximatePoints',
  'interpolatePoints',
  'sew',
  'makeSolid',
  'buildSolidFromFaces',
  'makeNonPlanarFace',
  'makeFaceOnSurface',
  'outerWire',
  'healWire',
  'healFace',
  'rotate',
  'mirror',
  'reverseShape',
  'vertexPosition',
  'split',
  'fillet',
  'shell',
  'thicken',
  'makeCircleArc',
  'makeHelixWire',
  'getSurfaceArea',
  'projectPointOnFace',
  'surfaceType',
  'subShapeCount',
  'isFace',
  'isWire',
  'isShell',
  'isEdge',
] as const

let rawPromise: Promise<RawOcctKernel> | null = null

/**
 * 取得原始 occt-wasm 内核（进程内单例）。
 *
 * 与 `initOcctWasm()` 是同一个实例——只做类型断言，不新建内核。
 *
 * @returns 原始内核句柄（Promise，首次调用时初始化 wasm）
 */
export function getRawKernel(): Promise<RawOcctKernel> {
  if (!rawPromise) {
    rawPromise = initOcctWasm().then((k) => k as unknown as RawOcctKernel)
  }
  return rawPromise
}
