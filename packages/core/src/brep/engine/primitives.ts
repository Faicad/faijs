/**
 * engine/primitives — BREP 引擎契约面（port 面，L1 核心面）
 *
 * ⚠️ 2026-09-24 契约面收窄（docs/plans/2026-09-24-brep-engine-api-narrowing-native-access.md
 * §Phase 2 / D1 / D9 / D10）：`BrepEngineApi` 的语义 = **所有已注册 BREP 引擎都真实现的
 * 方法**（occt 与 brepkit 双方语义可对齐的交集面，最大化口径）。判据唯一真源：
 * `api/surface/engine-method-map.json`（status ∈ {aligned, dialect} 的条目）。
 *
 * - 移出 L1 的方法（occt-only 语义）不再有中立名，平台代码直接走原生面：
 *   `getOcctKernel()` / `getBrepkitKernel()`（D3），op 侧用 `engines: ['occt']` 声明（D11）。
 * - 禁止任何 `as BrepEngineApi` 跨层断言（守卫见 §5 守卫清单）。
 * - 三个适配器的编译期断言 `_Assert*Api` 由此全部获得真校验力。
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
} from './types'

/**
 * BREP 引擎原语契约（L1 核心面）。所有句柄参数/返回值均为 BrepHandle（不透明值，§6.3）。
 * 引擎实现（occt/brepkit 适配器）负责内部句柄形态与 BrepHandle 的转换，以及方言消化
 * （如 brepkit surfaceArea → getSurfaceArea，与 matrix 方言的 toKernelMatrix 同构）。
 */
export interface BrepEngineApi {
  // ── 生命周期 ──
  /** 手工释放句柄（GC 型引擎实现为 no-op）。 */
  release(shape: BrepHandle): void
  /** 释放内核/句柄（引擎级释放语义；brepkit GC 型 no-op）。 */
  dispose(shape?: BrepHandle): void

  // ── 实体图元 ──
  makeBox(dx: number, dy: number, dz: number): BrepHandle
  makeBoxFromCorners(corner1: BrepVec3, corner2: BrepVec3): BrepHandle
  makeCylinder(radius: number, height: number): BrepHandle
  makeSphere(radius: number): BrepHandle
  makeCone(r1: number, r2: number, height: number): BrepHandle
  makeRectangle(width: number, height: number): BrepHandle
  makeEllipsoid(rx: number, ry: number, rz: number): BrepHandle
  makeTorus(majorRadius: number, minorRadius: number): BrepHandle
  makeVertex(x: number, y: number, z: number): BrepHandle

  // ── 造型运算 ──
  /**
   * 挤出：`{dx,dy,dz}` 为挤出向量（occt 方言）。
   * brepkit 方言（方向+距离、只吃 face）由适配器归一：`len = |v|`、`dir = v/len`；
   * `len === 0` 抛错；输入不是 face → 报错（显式失败，不静默降级，§3.6-1）。
   */
  extrude(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle
  /** 旋转挤出（绕过 center、方向 direction 的轴，angle 为度；输入需 face，brepkit 方言断言同 extrude）。 */
  revolveVec(shape: BrepHandle, center: BrepVec3, direction: BrepVec3, angleDeg: number): BrepHandle
  /** 缝合（tolerance 可选）。 */
  sew(shapes: BrepHandle[], tolerance?: number): BrepHandle
  /** 缝合并固化成实体。 */
  sewAndSolidify(faces: BrepHandle[], tolerance?: number): BrepHandle
  /** 抽壳（facesToRemove 移除面、thickness 壁厚、tolerance 容差）。 */
  shell(solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, tolerance: number): BrepHandle
  /** 点集凸包（tolerance 为容差）。 */
  hullFromPoints(points: BrepVec3[], tolerance: number): BrepHandle

  // ── 布尔与分割 ──
  fuse(a: BrepHandle, b: BrepHandle): BrepHandle
  cut(a: BrepHandle, b: BrepHandle): BrepHandle
  common(a: BrepHandle, b: BrepHandle): BrepHandle
  intersect(a: BrepHandle, b: BrepHandle): BrepHandle
  fuseAll(shapes: BrepHandle[]): BrepHandle
  /**
   * 平面求交线：solid 与「过 point、法向 normal 的无限平面」的交线（§3.6-2 新中立名）。
   * occt 适配器：大平面 face 作 tool 经原生 section 达成（Phase 1 探针 A 实测可达）。
   * 返回交线/顶点句柄数组（brepkit 返回 Uint32Array 句柄组，occt compound downcast 展开）。
   */
  sectionByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle[]
  /**
   * 平面二分：把 solid 沿「过 point、法向 normal 的无限平面」切成两半（§3.6-2 新中立名）。
   * occt 适配器：大平面 face 作 tool 经原生 splitter 达成（Phase 1 探针 A 实测，solidCount=2）。
   * 法向正侧 = `positive`（§3.7 返回口径）。
   */
  splitByPlane(
    shape: BrepHandle,
    point: BrepVec3,
    normal: BrepVec3,
  ): { positive: BrepHandle; negative: BrepHandle }

  // ── 倒角与圆角（Q7：只对齐等距 + 距角两种粒度）──
  /** 等距倒角：逐边 `BRepFilletAPI_MakeChamfer::Add(distance, E)`。 */
  chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle
  /**
   * 距角倒角：`AddDA(distance, angleDeg, E, F)`（brepkit 原生 chamferDistanceAngle，方言映射）。
   * ⚠️ F 由内核自选（外层第一个含该边的面），调用方不可指定。
   */
  chamferDistAngle(
    solid: BrepHandle, edges: BrepHandle[], distance: number, angleDeg: number,
  ): BrepHandle
  /** 等半径圆角：`BRepFilletAPI_MakeFillet::Add(radius, E)`。 */
  fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle
  /** 变半径圆角：单边 `Add(startRadius, endRadius, E)`（brepkit 吃 json 描述，适配器消化）。 */
  filletVariable(solid: BrepHandle, edge: BrepHandle, startRadius: number, endRadius: number): BrepHandle
  /**
   * 等半径圆角（带面演化）：modified/generated/deleted 用面 hash 编码（§7.5）。
   * brepkit 原生 filletWithEvolution，适配器映射。
   */
  filletWithHistory(
    solid: BrepHandle,
    edges: BrepHandle[],
    radius: number,
    inputFaceHashes: number[],
    hashUpperBound: number,
  ): BrepEvolutionData

  // ── 变换 ──
  // 矩阵口径（唯一权威）：matrix 参数是 **3×4 行主序、12 个 double**——
  // [r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]，与 brep/brep-ops.ts 的
  // matrixToArray()（THREE.Matrix4 column-major → 行主序 3×4）产出同构。
  // 各引擎方言不同（如 brepkit transformSolid 吃 4×4 行主序 16 元素）时，
  // 由该引擎适配层内部转换（brepkit-kernel/brepkitKernel.ts 的 toKernelMatrix
  // 唯一转换点），禁止要求调用方适配引擎方言。
  translate(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle
  scale(shape: BrepHandle, center: BrepVec3, factor: number): BrepHandle
  /** 3×4 行主序 12 元素矩阵（口径见上方"变换"节注释）。 */
  transform(shape: BrepHandle, matrix: number[]): BrepHandle
  /** 带位置矩阵放置（3×4 行主序 12 元素，口径见变换族注释）。 */
  located(shape: BrepHandle, matrix: number[]): BrepHandle
  locate(shape: BrepHandle, matrix: number[]): BrepHandle
  /** 一般变换（3×4 行主序 12 元素）。 */
  generalTransform(shape: BrepHandle, matrix: number[]): BrepHandle
  copy(shape: BrepHandle): BrepHandle
  /** 复制句柄（独立引用计数）。 */
  copyShape(shape: BrepHandle): BrepHandle
  /** 组合两个 3×4 行主序变换矩阵（12 元素）。 */
  composeTransform(m1: number[], m2: number[]): number[]
  /** 镜像（过 point、法向 normal 的平面）。 */
  mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle

  // ── 阵列 ──
  // 口径：两内核的 pattern 内核函数都返回 compound（含全部副本），适配器负责拆成数组。
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

  // ── 曲线构造 ──
  makeLineEdge(start: BrepVec3, end: BrepVec3): BrepHandle
  makeArcEdge(start: BrepVec3, mid: BrepVec3, end: BrepVec3): BrepHandle
  makeBezierEdge(controlPoints: BrepVec3[]): BrepHandle
  makeCircleEdge(center: BrepVec3, normal: BrepVec3, radius: number): BrepHandle

  // ── 拓扑构造 ──
  makeWire(edges: BrepHandle[]): BrepHandle
  makeFace(wire: BrepHandle): BrepHandle
  makeCompound(shapes: BrepHandle[]): BrepHandle
  addHolesInFace(face: BrepHandle, holeWires: BrepHandle[]): BrepHandle
  /** 三角面（三顶点）。 */
  buildTriFace(a: BrepVec3, b: BrepVec3, c: BrepVec3): BrepHandle

  // ── 三角化（BREP→mesh 唯一出口，断链物化依赖，硬必需） ──
  meshShape(shape: BrepHandle, options?: BrepTessellateOptions): BrepMeshResult
  wireframe(shape: BrepHandle, deflection?: number): BrepEdgeData

  // ── 拓扑查询 ──
  getSubShapes(shape: BrepHandle, type: BrepSubShapeType): BrepHandle[]
  subShapeHashes(shape: BrepHandle, type: BrepSubShapeType, hashUpperBound: number): number[]
  hashCode(shape: BrepHandle, upperBound: number): number
  isSame(a: BrepHandle, b: BrepHandle): boolean
  isSolid(shape: BrepHandle): boolean
  /** 方向标识（与内核 ShapeOrientation 同构：'forward'|'reversed'|'internal'|'external'）。 */
  shapeOrientation(shape: BrepHandle): string
  /** 边→面关联（brepkit 原生同名）。 */
  edgeToFaceMap(shape: BrepHandle): unknown
  /** 面的相邻面（同一 solid 内与 face 共享边的面；两内核原生都吃 (shape, face)）。 */
  adjacentFaces(shape: BrepHandle, face: BrepHandle): BrepHandle[]
  /** 两面共享的边。 */
  sharedEdges(a: BrepHandle, b: BrepHandle): BrepHandle[]

  // ── 几何求值 ──
  /** 曲线类型标识（与内核 CurveKind 同构的中立字符串形态）。 */
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
  /** 曲面质心。 */
  surfaceCenterOfMass(face: BrepHandle): BrepVec3
  /** Phase 1 钉死返回形态（topologyExt 仅读 radius）。 */
  getFaceCylinderData(face: BrepHandle): { radius: number } | null
  /** Phase 1 钉死返回形态（topologyExt 读 degree/periodic/rational）。 */
  getNurbsCurveData(edge: BrepHandle): { degree: number; periodic: boolean; rational: boolean } | null
  interpolatePoints(points: BrepVec3[], degree: number): BrepHandle

  /** 去特征（移除面集合）。 */
  defeature(shape: BrepHandle, faces: BrepHandle[]): BrepHandle
  /** 拔模。 */
  draft(shape: BrepHandle, faces: BrepHandle[], pull: BrepVec3, neutral: BrepVec3, angleDeg: number): BrepHandle
  removeHolesFromFace(face: BrepHandle): BrepHandle
  reverseShape(shape: BrepHandle): BrepHandle
  /** 边投影（方言参数由适配器消化）。 */
  projectEdges(shape: BrepHandle, origin: BrepVec3, direction: BrepVec3, xAxis: BrepVec3, hiddenLines: boolean, deflection: number): unknown

  // ── 测量（D5/D6：核心面只进双方都有的；linearCenterOfMass/inertia/distance 是 L2 平台面）──
  getBoundingBox(shape: BrepHandle, useTriangulation?: boolean): BrepBoundingBox
  getVolume(shape: BrepHandle): number
  getCenterOfMass(shape: BrepHandle): BrepVec3
  /** 表面积（D6：面积进 L1；brepkit 原生 surfaceArea/faceArea，适配器映射）。 */
  getSurfaceArea(shape: BrepHandle): number
  /** 长度（D6：进 L1；brepkit 原生 length/wireLength，wire 与 edge 入参差异由适配器判别）。 */
  getLength(shape: BrepHandle): number

  // ── 校验与修复 ──
  isValid(shape: BrepHandle): boolean
  unifySameDomain(shape: BrepHandle): BrepHandle
  healSolid(shape: BrepHandle, tolerance?: number): BrepHandle
  fixShape(shape: BrepHandle): BrepHandle
  fixFaceOrientations(shape: BrepHandle): BrepHandle
  removeDegenerateEdges(shape: BrepHandle, tolerance?: number): BrepHandle

  // ── IO ──
  importStep(data: string | ArrayBuffer): BrepHandle
  exportStep(shape: BrepHandle): string
  importStl(data: string | ArrayBuffer): BrepHandle
  fromBREP(data: string): BrepHandle

  // ── 面演化（仅双方都有原生/可对齐实现的三员，D1）──
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
}

/**
 * 编译期完整性断言（D1）：实现类型必须逐成员满足 L1 核心面。
 * 三处守卫 `_AssertOcctApi` / `_AssertBrepkitApi` / `_AssertBrepMockApi` 同时生效。
 */
export type AssertSatisfiesBrepEngineApi<Impl extends BrepEngineApi> = Impl
