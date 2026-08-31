/**
 * engine/primitives — BREP 引擎契约面（port 面）
 *
 * 设计：docs/plans/2026-08-30-brep-engine-switch.md §7.4
 *
 * ⚠️ Phase 0 落地形态：覆盖 §2.3 实测的 66 个被调方法（BrepHandle 中立签名），
 * 供类型解耦使用。Phase 1 按 §7.4 扩到 83 项分 14 族，并落地编译期完整性守卫
 * （_AssertSatisfiesBrepEngineApi，抄 brepjs §3.2）。
 * 复杂返回类型（XCAF 文档 / NURBS 曲线数据等）在 Phase 0 用 unknown 占位，Phase 1 钉死。
 *
 * 命名沿用 occt-wasm 现状——最小迁移成本 + 可演进（§7.4 的取舍）。
 */

import type {
  BrepBoundingBox,
  BrepCurveParameters,
  BrepEdgeData,
  BrepEvolutionData,
  BrepHandle,
  BrepMeshResult,
  BrepSubShapeType,
  BrepTessellateOptions,
  BrepUvBounds,
  BrepVec3,
  BrepXcafDocument,
} from './types'

/**
 * BREP 引擎原语契约。所有句柄参数/返回值均为 BrepHandle（不透明值，§6.3）。
 * 引擎实现（occt/remus 适配器）负责内部句柄形态与 BrepHandle 的转换。
 */
export interface BrepEngineApi {
  // ── 生命周期 ──
  /** 手工释放句柄（GC 型引擎实现为 no-op）。 */
  release(shape: BrepHandle): void

  // ── 实体图元 ──
  makeBox(dx: number, dy: number, dz: number): BrepHandle
  makeBoxFromCorners(corner1: BrepVec3, corner2: BrepVec3): BrepHandle
  makeCylinder(radius: number, height: number): BrepHandle
  makeSphere(radius: number): BrepHandle
  makeCone(r1: number, r2: number, height: number): BrepHandle
  makeRectangle(width: number, height: number): BrepHandle

  // ── 造型运算 ──
  extrude(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle
  loft(wires: BrepHandle[], isSolid: boolean, ruled: boolean): BrepHandle

  // ── 布尔与分割 ──
  fuse(a: BrepHandle, b: BrepHandle): BrepHandle
  cut(a: BrepHandle, b: BrepHandle): BrepHandle
  common(a: BrepHandle, b: BrepHandle): BrepHandle
  intersect(a: BrepHandle, b: BrepHandle): BrepHandle
  section(a: BrepHandle, b: BrepHandle): BrepHandle
  fuseAll(shapes: BrepHandle[]): BrepHandle

  // ── 倒角（directEdit 能力）──
  /** 等距倒角：逐边 `BRepFilletAPI_MakeChamfer::Add(distance, E)`。 */
  chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle
  /**
   * 距角倒角：`AddDA(distance, angleRad, E, F)`。
   * ⚠️ F 由内核自选（外层 TopExp_Explorer 第一个含该边的面），调用方不可指定。
   */
  chamferDistAngle(
    solid: BrepHandle, edges: BrepHandle[], distance: number, angleDeg: number,
  ): BrepHandle

  // ── 变换 ──
  translate(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle
  scale(shape: BrepHandle, center: BrepVec3, factor: number): BrepHandle
  transform(shape: BrepHandle, matrix: number[]): BrepHandle
  located(shape: BrepHandle, matrix: number[]): BrepHandle
  generalTransform(shape: BrepHandle, matrix: number[]): BrepHandle
  copy(shape: BrepHandle): BrepHandle

  // ── 曲线构造 ──
  makeLineEdge(start: BrepVec3, end: BrepVec3): BrepHandle
  makeArcEdge(start: BrepVec3, mid: BrepVec3, end: BrepVec3): BrepHandle
  makeBezierEdge(controlPoints: BrepVec3[]): BrepHandle

  // ── 拓扑构造 ──
  makeWire(edges: BrepHandle[]): BrepHandle
  makeFace(wire: BrepHandle): BrepHandle
  makeCompound(shapes: BrepHandle[]): BrepHandle
  sewAndSolidify(faces: BrepHandle[], tolerance?: number): BrepHandle
  buildTriFace(a: BrepVec3, b: BrepVec3, c: BrepVec3): BrepHandle
  addHolesInFace(face: BrepHandle, holeWires: BrepHandle[]): BrepHandle

  // ── 三角化（BREP→mesh 唯一出口，断链物化依赖，硬必需） ──
  meshShape(shape: BrepHandle, options?: BrepTessellateOptions): BrepMeshResult
  wireframe(shape: BrepHandle, deflection?: number): BrepEdgeData

  // ── 拓扑查询 ──
  getSubShapes(shape: BrepHandle, type: BrepSubShapeType): BrepHandle[]
  /** 批量查询（§2.3：生产路径零调用，仅测试使用；Phase 1 钉死返回形态）。 */
  queryBatch(shapes: BrepHandle[]): Array<{ area: number }>
  subShapeHashes(shape: BrepHandle, type: BrepSubShapeType, hashUpperBound: number): number[]
  hashCode(shape: BrepHandle, upperBound: number): number
  isSame(a: BrepHandle, b: BrepHandle): boolean
  isSolid(shape: BrepHandle): boolean
  /** 方向标识（与内核 ShapeOrientation 同构：'forward'|'reversed'|'internal'|'external'）。 */
  shapeOrientation(shape: BrepHandle): string

  // ── 几何求值 ──
  /** 曲面类型标识（与内核 SurfaceKind 同构的中立字符串形态）。 */
  curveType(edge: BrepHandle): string
  curvePointAtParam(edge: BrepHandle, param: number): BrepVec3
  curveTangent(edge: BrepHandle, param: number): BrepVec3
  curveParameters(edge: BrepHandle): BrepCurveParameters
  curveIsClosed(edge: BrepHandle): boolean
  curveLength(edge: BrepHandle): number
  /** 曲面类型标识（与内核 SurfaceKind 同构的中立字符串形态）。 */
  surfaceType(face: BrepHandle): string
  surfaceNormal(face: BrepHandle, u: number, v: number): BrepVec3
  pointOnSurface(face: BrepHandle, u: number, v: number): BrepVec3
  uvBounds(face: BrepHandle): BrepUvBounds
  getSurfaceCenterOfMass(face: BrepHandle): BrepVec3
  /** Phase 1 钉死返回形态（topologyExt 仅读 radius）。 */
  getFaceCylinderData(face: BrepHandle): { radius: number } | null
  /** Phase 1 钉死返回形态（topologyExt 读 degree/periodic/rational）。 */
  getNurbsCurveData(edge: BrepHandle): { degree: number; periodic: boolean; rational: boolean } | null

  // ── 测量 ──
  getBoundingBox(shape: BrepHandle, useTriangulation?: boolean): BrepBoundingBox
  getVolume(shape: BrepHandle): number
  getCenterOfMass(shape: BrepHandle): BrepVec3

  // ── 校验与修复 ──
  isValid(shape: BrepHandle): boolean
  unifySameDomain(shape: BrepHandle): BrepHandle
  healSolid(shape: BrepHandle, tolerance?: number): BrepHandle
  fixShape(shape: BrepHandle): BrepHandle
  fixFaceOrientations(shape: BrepHandle): BrepHandle
  removeDegenerateEdges(shape: BrepHandle): BrepHandle

  // ── IO ──
  importStep(data: string | ArrayBuffer): BrepHandle
  exportStep(shape: BrepHandle): string
  importStl(data: string | ArrayBuffer): BrepHandle
  fromBREP(data: string): BrepHandle

  // ── 面演化（可选能力槽 §7.5 EvolutionCapability） ──
  cutWithHistory(
    a: BrepHandle,
    b: BrepHandle,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  fuseWithHistory(
    a: BrepHandle,
    b: BrepHandle,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  intersectWithHistory(
    a: BrepHandle,
    b: BrepHandle,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData

  // ── XCAF 装配（可选能力槽 §7.5 AssemblyCapability，Phase 1 钉死完整形态） ──
  createXCAFDocument(): BrepXcafDocument
  importXCAFFromSTEP(stepData: string): BrepXcafDocument
}

/**
 * 编译期完整性守卫（§7.8，抄 brepjs §3.2 的 _AssertSatisfiesKernelShape）。
 *
 * 用法（适配器里）：
 * ```ts
 * type _AssertOcct = AssertSatisfiesBrepEngineApi<Awaited<ReturnType<typeof initOcctWasm>>>
 * ```
 * 若实现类型缺少接口中的任何方法（或签名不兼容）→ tsc 报错并列出缺失属性。
 * 引擎换用 / 接口演进（Phase 1 扩到 83 项）时，失配在编译期暴露，而非运行时黑盒。
 */
export type AssertSatisfiesBrepEngineApi<Impl extends BrepEngineApi> = Impl
