/**
 * engine/primitives — BREP 引擎契约面（port 面）
 *
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

  // ── 倒角与圆角（directEdit 能力）──
  /** 等距倒角：逐边 `BRepFilletAPI_MakeChamfer::Add(distance, E)`。 */
  chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle
  /**
   * 距角倒角：`AddDA(distance, angleRad, E, F)`。
   * ⚠️ F 由内核自选（外层 TopExp_Explorer 第一个含该边的面），调用方不可指定。
   */
  chamferDistAngle(
    solid: BrepHandle, edges: BrepHandle[], distance: number, angleDeg: number,
  ): BrepHandle
  /** 等半径圆角：`BRepFilletAPI_MakeFillet::Add(radius, E)`。 */
  fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle
  /** 变半径圆角：单边 `BRepFilletAPI_MakeFillet::Add(startRadius, endRadius, E)`。 */
  filletVariable(solid: BrepHandle, edge: BrepHandle, startRadius: number, endRadius: number): BrepHandle
  /**
   * 等半径圆角（WithHistory）：返回面演化数据，供 roleTable 传播。
   * modified/generated/deleted 用面 hash 编码（§7.5）。
   */
  filletWithHistory(
    solid: BrepHandle,
    edges: BrepHandle[],
    radius: number,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  /**
   * 等距倒角（WithHistory）：返回面演化数据，供 roleTable 传播。
   * modified/generated/deleted 用面 hash 编码（§7.5）。
   */
  chamferWithHistory(
    solid: BrepHandle,
    edges: BrepHandle[],
    distance: number,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData

  // ── 变换 ──
  // 矩阵口径（唯一权威）：matrix 参数是 **3×4 行主序、12 个 double**——
  // [r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]，与 brep/brep-ops.ts 的
  // matrixToArray()（THREE.Matrix4 column-major → 行主序 3×4）产出同构。
  // 各引擎方言不同（如 brepkit transformSolid 吃 4×4 行主序 16 元素）时，
  // 由该引擎适配层内部转换（见 brepkit-kernel/brepkitKernel.ts 的 toKernelMatrix
  // 唯一转换点），禁止要求调用方适配引擎方言。
  translate(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle
  scale(shape: BrepHandle, center: BrepVec3, factor: number): BrepHandle
  /** 3×4 行主序 12 元素矩阵（口径见上方"变换"节注释）。 */
  transform(shape: BrepHandle, matrix: number[]): BrepHandle
  /** 3×4 行主序 12 元素矩阵（口径见上方"变换"节注释）。 */
  located(shape: BrepHandle, matrix: number[]): BrepHandle
  /** 3×4 行主序 12 元素矩阵（口径见上方"变换"节注释）。 */
  generalTransform(shape: BrepHandle, matrix: number[]): BrepHandle
  copy(shape: BrepHandle): BrepHandle

  // ── 阵列（Phase 2：pattern 族；occt-wasm 原生 + brepkit wasm 已导出） ──
  // 口径（vendored brepjs 内核调用面，docs/plans/2026-09-23-brep-engine-switchability-rework.md §Phase 2）：
  //   - 两内核的 pattern 内核函数都返回 compound（含全部副本），适配器负责拆成数组；
  //   - 不声明 rectangularPattern：vendored rectangularPattern 是纯 JS 组合
  //     （compoundOpsFns.ts，translate + fuseAll），不调内核方法（capability-map 实证）；
  //   - 不声明裸 mirror/rotate：vendored transformFns 全部走 `*WithHistory` 内核
  //     （transformFns.ts:29-99 实证），基础方法仅 2D sketcher 面使用（走 KernelAdapter）。
  /** 线性阵列：沿 direction 复制 count 份（含原位置），返回各份副本句柄数组。 */
  linearPattern(shape: BrepHandle, direction: BrepVec3, spacing: number, count: number): BrepHandle[]
  /** 环形阵列：绕 axis 均分 angleStep 每份，返回各份副本句柄数组。 */
  circularPattern(
    shape: BrepHandle,
    center: BrepVec3,
    axis: BrepVec3,
    angleStep: number,
    count: number,
  ): BrepHandle[]
  /** 二维栅格阵列：沿两方向复制 countX×countY 份，返回 compound 单句柄。 */
  gridPattern(
    shape: BrepHandle,
    directionX: BrepVec3,
    directionY: BrepVec3,
    spacingX: number,
    spacingY: number,
    countX: number,
    countY: number,
  ): BrepHandle

  // ── 查询与测量（Phase 3：capability-map 64 方法登记补全——occt-wasm 原生或
  //   vendored 适配器组合面；brepkit 无实现的能力保持不声明，静态判定拦截） ──
  /** 轴对齐包围盒。 */
  boundingBox(shape: BrepHandle): BrepBoundingBox
  /** 形状类型（vertex/edge/wire/face/shell/solid）。 */
  shapeType(shape: BrepHandle): BrepSubShapeType
  /** 句柄是否为空（无效引用）。 */
  isNull(shape: BrepHandle): boolean
  /** 遍历子形状句柄（与 getSubShapes 同族，返回句柄数组）。 */
  iterShapes(shape: BrepHandle): BrepHandle[]
  /** 曲面质心。 */
  surfaceCenterOfMass(face: BrepHandle): BrepVec3
  /** 带位置矩阵放置（3×4 行主序 12 元素，口径见变换族注释）。 */
  locate(shape: BrepHandle, matrix: number[]): BrepHandle
  /** 复制句柄（独立引用计数）。 */
  copyShape(shape: BrepHandle): BrepHandle
  /** 类型降级（目标子形状类型；不匹配返回空句柄）。 */
  downcast(shape: BrepHandle, targetType: BrepSubShapeType): BrepHandle
  /** 释放内核/句柄（引擎级释放语义；brepkit GC 型 no-op）。 */
  dispose(shape?: BrepHandle): void
  /** 组合两个 3×4 行主序变换矩阵（12 元素）。 */
  composeTransform(m1: number[], m2: number[]): number[]

  // ── 构形与修复（Phase 3 登记；brepkit 未实现 → 能力表不声明） ──
  /** 拉伸律面构造（profile 为曲线描述串）。 */
  buildExtrusionLaw(profile: string, length: number, endFactor: number): BrepHandle
  /** 曲面上的边构造（curve 为 2D 曲线句柄，宽化 BrepHandle 口径）。 */
  buildEdgeOnSurface(curve: BrepHandle, surface: BrepHandle): BrepHandle
  /** 面修复（ShapeFix，容忍度可选）。 */
  healFace(shape: BrepHandle, tolerance?: number): BrepHandle
  /** 线修复（ShapeFix，容忍度可选）。 */
  healWire(shape: BrepHandle, tolerance?: number): BrepHandle
  /** 线自相交修复。 */
  fixSelfIntersection(wire: BrepHandle): BrepHandle
  /** 点集凸包（tolerance 为容差）。 */
  hullFromPoints(points: BrepVec3[], tolerance: number): BrepHandle
  /** 高级放样（options 形态同 vendored loftAdvanced）。 */
  loftAdvanced(wires: BrepHandle[], options?: { solid?: boolean; ruled?: boolean; tolerance?: number }): BrepHandle
  /** 椭球（三半轴）。 */
  makeEllipsoid(rx: number, ry: number, rz: number): BrepHandle
  /** 曲面上的面构造（face 为承载面、wire 为边界）。 */
  makeFaceOnSurface(face: BrepHandle, wire: BrepHandle): BrepHandle
  /** 圆环（主/次半径）。 */
  makeTorus(majorRadius: number, minorRadius: number): BrepHandle
  /** 顶点构造。 */
  makeVertex(x: number, y: number, z: number): BrepHandle
  /** 混合线构造（items 为边/顶点混合）。 */
  makeWireFromMixed(items: BrepHandle[]): BrepHandle
  /** 镜像（过 point、法向 normal 的平面）。 */
  mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle
  /** 旋转（绕过 center、方向 direction 的轴，angle 为度）。 */
  revolveVec(shape: BrepHandle, center: BrepVec3, direction: BrepVec3, angleDeg: number): BrepHandle
  /** 缝合（tolerance 可选）。 */
  sew(shapes: BrepHandle[], tolerance?: number): BrepHandle
  /** 抽壳（facesToRemove 移除面、thickness 壁厚、tolerance 容差）。 */
  shell(solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, tolerance: number): BrepHandle
  /** 简单扫掠（profile 沿 spine 扫出实体）。 */
  simplePipe(profile: BrepHandle, spine: BrepHandle): BrepHandle
  /** 简化几何。 */
  simplify(shape: BrepHandle): BrepHandle
  /** 分割（tools 切割体；返回单个结果句柄，语义同 vendored boolOps.split）。 */
  split(shape: BrepHandle, tools: BrepHandle[]): BrepHandle
  /** 管壳扫掠（freenet/smooth 可选）。 */
  sweepPipeShell(profile: BrepHandle, spine: BrepHandle, freenet?: boolean, smooth?: boolean): BrepHandle
  /** 非正交一般变换（3×4 行主序 12 元素）。 */
  generalTransformNonOrthogonal(shape: BrepHandle, matrix: number[]): BrepHandle
  /** 一般变换（带面演化；3×4 行主序 12 元素，适配器拆分 linear/translation）。 */
  generalTransformWithHistory(
    shape: BrepHandle,
    matrix: number[],
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  /** 组合变换（带面演化；3×4 行主序 12 元素）。 */
  applyComposedTransformWithHistory(
    shape: BrepHandle,
    matrix: number[],
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData


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

  // ── 面演化 · Phase 0.1 补齐的 7 个（occt-wasm 运行时本就存在） ──
  //
  // ⚠️ 为什么此前只有 5 个：faijs 只绑了 boolean 与 fillet/chamfer，那 7 个在
  // `occt-wasm@3.8.4` 的运行时**一直都在**（dist/index.d.ts:458-472 共 12 个），
  // 只是 faijs 类型层未声明、也无人调用。补齐**不动 WASM**。
  //
  // ⚠️ 注意：`initOcctWasm()` 的返回类型在本文件之外已被硬断言为 BrepEngineApi
  // （occtKernel.ts:88/95/106/112 `as unknown as`）⇒ 下方 `_AssertOcctApi`
  // 恒真、**无校验力**。声明 ≠ 运行时存在：存在性由
  // `packages/core/src/brep/engine/evolution-bindings.test.ts` 的冒烟测试钉住。

  /** 平移 + 面演化（权威 hash→hash 映射，替代序号对齐近似）。 */
  translateWithHistory(
    shape: BrepHandle,
    dx: number,
    dy: number,
    dz: number,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  /** 绕任意轴旋转 + 面演化。`axis = {point, direction}`，`angleRad` 为**弧度**。 */
  rotateWithHistory(
    shape: BrepHandle,
    axis: { point: BrepVec3; direction: BrepVec3 },
    angleRad: number,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  /** 镜像 + 面演化。`point` 为镜像面上一点，`normal` 为镜像面法向。 */
  mirrorWithHistory(
    shape: BrepHandle,
    point: BrepVec3,
    normal: BrepVec3,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  /** 缩放 + 面演化。⚠️ 仅**均匀**缩放（`factor: number`）；非均匀走 `generalTransform`（无历史）。 */
  scaleWithHistory(
    shape: BrepHandle,
    center: BrepVec3,
    factor: number,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  /** 抽壳 + 面演化。`faces` 为被移除的面（开口），`thickness` 为壁厚。 */
  shellWithHistory(
    solid: BrepHandle,
    faces: BrepHandle[],
    thickness: number,
    tolerance: number,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  /** 偏移 + 面演化。 */
  offsetWithHistory(
    solid: BrepHandle,
    distance: number,
    tolerance: number,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData
  /** 加厚（面/壳 → 实体）+ 面演化。 */
  thickenWithHistory(
    shape: BrepHandle,
    thickness: number,
    tolerance: number,
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
