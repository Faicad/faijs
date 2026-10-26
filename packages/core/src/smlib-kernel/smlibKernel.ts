/**
 * smlib-kernel/smlibKernel — smlib（usd-brep SM_API）→ faijs BrepEngineApi 适配器
 *
 * 对照 brepkit-kernel/brepkitKernel.ts 形态：显式对象字面量实现 L1 契约
 * `BrepEngineApi`，方言在适配器内消化。smlib 是 emscripten standalone wasm，
 * 句柄 = SmObject*（u32 wasm 堆指针），与 BrepHandle(number) 直通零转换。
 *
 * 本文件按方案文档 `docs/plans/2026-10-26-smlib-brep-engine-plan.md` §5.4 落地：
 * - 生命周期：SmBrep* 句柄登记表（face/edge 是 Brep-owned 借用，不释放）；
 *   释放走内核桥 `SmApiDeleteBrepEx`（SM_API 无删除原语，P1 桥补齐）。
 * - 布尔：SmApiBoolean* 是**原地消耗式**（a 原地变、b 被内核删除）——适配器
 *   **先 SmApiBrepCopy×2 副本化**，保用户句柄与语言层"句柄契约"（用户已确认：
 *   keepHidden 已取消、仅句柄生命周期契约需副本化，见方案文档 §4.2/§5.4）。
 * - 三角化：SmApiTessellate 输出多边形网格 SmPolyBrep（无公共三角形导出），
 *   走内核桥 `SmApiTessellateEx` 展平为独立三角形；faceGroups 的 facePtr 合并后
 *   用**与拓扑查询同一套** face hash 编码（红线 §4.4：subShapeHashes 与
 *   meshShape faceGroups 必须同源）。
 * - 线框：`SmApiTessellateBoundariesEx` 桥（points + per-edge counts + edges）。
 *
 * P1 实现集（方案文档 §6 P1）：生命周期、图元、布尔（副本化）、变换、测量、
 * meshShape/wireframe、getSubShapes（face/edge）。其余 L1 方法 = `unsupported` 桩
 * （P2/P3 按计划接线；缺能力由 op 的 `engines: ['occt'|'brepkit']` 声明在装配前拒绝）。
 */
import { initSmlibWasm, resetSmlibWasm, type SmlibKernel } from './smlibWasm'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { BREP_HASH_BOUND } from '../brep/engine/types'
import type {
  BrepBoundingBox,
  BrepCurveParameters,
  BrepEdgeData,
  BrepEvolutionData,
  BrepHandle,
  BrepMeshResult,
  BrepNurbsCurveData,
  BrepSubShapeType,
  BrepTessellateOptions,
  BrepUvBounds,
  BrepVec3,
} from '../brep/engine/types'

// SM_SUCCESS（SmMessages.h: #define SM_SUCCESS 1000L）
const SM_SUCCESS = 1000

/** 适配器内部显式失败（能力缺失：op 级 `engines` 声明在装配前拦截，桩兜底防御）。 */
function unsupported(name: string): never {
  throw new Error(`[smlib-kernel] ${name}: not implemented in P1 (plan §6 P2/P3)`)
}

// ── 句柄登记：只有 SmBrep*（solid）需要释放 ──
//
// smlib 的 face/edge 句柄是 Brep-owned 借用指针（SmApiGetFaces/GetEdges 返回
// "Borrowed Brep-owned"），不可 delete；SmBrep* 由 `SmApiDeleteBrepEx` 释放。
// 登记表记录哪些句柄是 SmBrep*——release 只删登记过的（查表即类型判别）。
const solidHandles = new Set<number>()

/** 登记新 SmBrep* 句柄（solid 类）。 */
function newSolid(ptr: number): BrepHandle {
  if (ptr) solidHandles.add(ptr)
  return ptr as BrepHandle
}

// ── 面/边 hash（红线：meshShape faceGroups 与 subShapeHashes 同源） ──
//
// faijs 无子形状 hash 的引擎原生支持（用户已确认"无子形状 hash 与顶点枚举=适配器
// 自建"）。自建方案：句柄指针本身（SmFace*/SmEdge* 在 wasm 堆内稳定、生命周期内
// 唯一）取模 BREP_HASH_BOUND。同一句柄在 meshShape 与 getSubShapes 两条路径得到
// 相同 hash ⇒ 拓扑提取可回查（types.ts 的 BREP_HASH_BOUND 是唯一真源）。
const subShapeHashOf = (ptr: number, upperBound: number): number => (ptr >>> 0) % upperBound

/** 读取内存的辅助：memory 可能 growth（buffer 被替换），每次调用动态取。 */
function memOf(k: SmlibKernel): DataView {
  return new DataView(k.memory.buffer)
}

/** 成功校验 + 抛错（带函数名与返回码）。 */
function expectOk(st: number, what: string): void {
  if (st !== SM_SUCCESS) throw new Error(`[smlib-kernel] ${what} failed: SM status ${st}`)
}

/** 图元通用辅助：origin=(0,0,0) + out 槽 4 字节。 */
function primitiveArgs(k: SmlibKernel): { arg: number; dv: DataView } {
  const arg = k.malloc(28)
  const dv = memOf(k)
  dv.setFloat64(arg, 0, true)
  dv.setFloat64(arg + 8, 0, true)
  dv.setFloat64(arg + 16, 0, true)
  dv.setUint32(arg + 24, 0, true)
  return { arg, dv }
}

/**
 * smlib 原语集合（BrepEngineApi 显式对象字面量）。初始化共享内核单例
 * （initSmlibWasm 幂等）；getSmlibKernel() 返回已就绪实例，disposeSmlib() 释放全部
 * 登记句柄并 reset（对齐 brepkitKernel 的 getBrepKitKernel/disposeBrekit 三件套）。
 */
export type SmlibPrimitives = BrepEngineApi

let primitivesSingleton: SmlibPrimitives | null = null

/** 创建（幂等）并返回 smlib 原语集合。
 * @returns smlib 内核的 BrepEngineApi 实现（单例，未初始化时先装载 wasm）。 */
export async function createSmlibPrimitives(): Promise<SmlibPrimitives> {
  if (primitivesSingleton) return primitivesSingleton
  const k = await initSmlibWasm()

  // ── 布尔（副本化）辅助 ──
  // SmApiBoolean* 是原地消耗式（a 变、b 被内核删除）——先深拷贝两入参，
  // 保用户句柄与语言层句柄契约（方案文档 §4.2/§5.4）。pb 不登记：内核拥有
  // （成功被删、失败语义不明）；pa 与 result 登记（都要我们释放）。
  function booleanOp(opName: string, a: BrepHandle, b: BrepHandle, what: string): BrepHandle {
    const out = k.malloc(4)
    const aCopy = k.malloc(4)
    const bCopy = k.malloc(4)
    try {
      const dv = memOf(k)
      dv.setUint32(aCopy, 0, true)
      dv.setUint32(bCopy, 0, true)
      expectOk(k.find('SmApiBrepCopy')(a, aCopy), `${what}: copy(a)`)
      expectOk(k.find('SmApiBrepCopy')(b, bCopy), `${what}: copy(b)`)
      const pa = dv.getUint32(aCopy, true)
      const pb = dv.getUint32(bCopy, true)
      if (!pa || !pb) throw new Error(`[smlib-kernel] ${what}: brep copy returned null`)
      solidHandles.add(pa)
      dv.setUint32(out, 0, true)
      const st = k.find(opName)(pa, pb, out)
      if (st !== SM_SUCCESS) {
        // 失败：释放 pa（副本 a）；pb 归属内核，不碰（避免悬垂 delete）。
        solidHandles.delete(pa)
        k.find('SmApiDeleteBrepEx')(pa)
        throw new Error(`[smlib-kernel] ${what} failed: SM status ${st}`)
      }
      const result = dv.getUint32(out, true)
      if (!result) throw new Error(`[smlib-kernel] ${what}: null result`)
      solidHandles.add(result) // pa 已在表（Set 去重）；result 可能是新指针
      return result as BrepHandle
    } finally {
      k.free(out)
      k.free(aCopy)
      k.free(bCopy)
    }
  }

  const primitives: SmlibPrimitives = {
    // ── 生命周期 ──
    release(_shape: BrepHandle): void {
      // faijs 契约：release 只释放句柄引用，不删除内核对象（同 brepkit GC 型语义——
      // 对象生命周期由运行时统一管理）。若在此删除 SmBrep，buildTopology 的
      // transient 释放（transient 含 getSubShapes(shape,'solid') 返回的实体句柄）
      // 会把 solidCache 仍持有的实体误删（实测：box2 在 buildNamingInput 时
      // GetFacesEx 返回 SM_ERR=1001）。SmBrep 删除只发生在布尔消耗（SmApiBoolean
      // 内建）与 booleanOp 失败分支。
    },
    dispose(_shape?: BrepHandle): void {
      for (const p of solidHandles) k.find('SmApiDeleteBrepEx')(p)
      solidHandles.clear()
    },

    // ── 实体图元 ──
    makeBox(dx: number, dy: number, dz: number): BrepHandle {
      const { arg, dv } = primitiveArgs(k)
      try {
        const st = k.find('SmApiCreateBox')(arg, dx, dy, dz, arg + 24)
        expectOk(st, 'makeBox')
        return newSolid(dv.getUint32(arg + 24, true))
      } finally {
        k.free(arg)
      }
    },
    makeBoxFromCorners(corner1: BrepVec3, corner2: BrepVec3): BrepHandle {
      const b = primitives.makeBox(corner2.x - corner1.x, corner2.y - corner1.y, corner2.z - corner1.z)
      return primitives.translate(b, corner1.x, corner1.y, corner1.z)
    },
    makeCylinder(radius: number, height: number): BrepHandle {
      // smlib：center 是底面中心（探针实证 bbox z∈[0,h]），+Z 向上。
      const { arg, dv } = primitiveArgs(k)
      try {
        const st = k.find('SmApiCreateCylinder')(arg, radius, height, arg + 24)
        expectOk(st, 'makeCylinder')
        return newSolid(dv.getUint32(arg + 24, true))
      } finally {
        k.free(arg)
      }
    },
    makeSphere(radius: number): BrepHandle {
      const { arg, dv } = primitiveArgs(k)
      try {
        const st = k.find('SmApiCreateSphere')(arg, radius, arg + 24)
        expectOk(st, 'makeSphere')
        return newSolid(dv.getUint32(arg + 24, true))
      } finally {
        k.free(arg)
      }
    },
    makeCone(r1: number, r2: number, height: number): BrepHandle {
      // SmApiCreateCone(base origin, rBase, rTop, h)——base 为底面中心，h 全高。
      const { arg, dv } = primitiveArgs(k)
      try {
        const st = k.find('SmApiCreateCone')(arg, r1, r2, height, arg + 24)
        expectOk(st, 'makeCone')
        return newSolid(dv.getUint32(arg + 24, true))
      } finally {
        k.free(arg)
      }
    },
    makeTorus(majorRadius: number, minorRadius: number): BrepHandle {
      const { arg, dv } = primitiveArgs(k)
      try {
        const st = k.find('SmApiCreateTorus')(arg, majorRadius, minorRadius, arg + 24)
        expectOk(st, 'makeTorus')
        return newSolid(dv.getUint32(arg + 24, true))
      } finally {
        k.free(arg)
      }
    },
    makeRectangle(width: number, height: number): BrepHandle {
      // smlib 无矩形面图元（Plane 是无限平面/参数化平面，P2 评估）→ P1 桩。
      void width
      void height
      return unsupported('makeRectangle')
    },
    makeEllipsoid(rx: number, ry: number, rz: number): BrepHandle {
      void rx; void ry; void rz
      return unsupported('makeEllipsoid')
    },
    makeVertex(x: number, y: number, z: number): BrepHandle {
      void x; void y; void z
      return unsupported('makeVertex')
    },

    // ── 造型运算（P2：extrude 走 SmApiCreateLinearSweep 桥；其余待评估）──
    extrude(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle {
      void shape; void dx; void dy; void dz
      return unsupported('extrude')
    },
    revolveVec(shape: BrepHandle, center: BrepVec3, direction: BrepVec3, angleDeg: number): BrepHandle {
      void shape; void center; void direction; void angleDeg
      return unsupported('revolveVec')
    },
    sweep(profile: BrepHandle, spine: BrepHandle): BrepHandle {
      void profile; void spine
      return unsupported('sweep')
    },
    loft(sections: BrepHandle[], ruled: boolean, endPoint?: BrepVec3): BrepHandle {
      void sections; void ruled; void endPoint
      return unsupported('loft')
    },
    sew(shapes: BrepHandle[], tolerance?: number): BrepHandle {
      void shapes; void tolerance
      return unsupported('sew')
    },
    sewAndSolidify(faces: BrepHandle[], tolerance?: number): BrepHandle {
      void faces; void tolerance
      return unsupported('sewAndSolidify')
    },
    shell(solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, tolerance: number): BrepHandle {
      void solid; void facesToRemove; void thickness; void tolerance
      return unsupported('shell')
    },
    hullFromPoints(points: BrepVec3[], tolerance: number): BrepHandle {
      void points; void tolerance
      return unsupported('hullFromPoints')
    },
    bsplineSurface(points: BrepVec3[], rows: number, cols: number): BrepHandle {
      void points; void rows; void cols
      return unsupported('bsplineSurface')
    },
    makeSolid(shell: BrepHandle): BrepHandle {
      void shell
      return unsupported('makeSolid')
    },
    thicken(shape: BrepHandle, thickness: number, tolerance?: number): BrepHandle {
      void shape; void thickness; void tolerance
      return unsupported('thicken')
    },

    // ── 布尔与分割（副本化保句柄契约）──
    fuse(a: BrepHandle, b: BrepHandle): BrepHandle {
      return booleanOp('SmApiBooleanUnion', a, b, 'fuse')
    },
    cut(a: BrepHandle, b: BrepHandle): BrepHandle {
      return booleanOp('SmApiBooleanDifference', a, b, 'cut')
    },
    common(a: BrepHandle, b: BrepHandle): BrepHandle {
      return booleanOp('SmApiBooleanIntersection', a, b, 'common')
    },
    intersect(a: BrepHandle, b: BrepHandle): BrepHandle {
      return booleanOp('SmApiBooleanIntersection', a, b, 'intersect')
    },
    fuseAll(shapes: BrepHandle[]): BrepHandle {
      void shapes
      return unsupported('fuseAll') // P2：SmApiMergeBreps 桥化
    },
    sectionByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle[] {
      void shape; void point; void normal
      return unsupported('sectionByPlane')
    },
    splitByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): { positive: BrepHandle; negative: BrepHandle } {
      void shape; void point; void normal
      return unsupported('splitByPlane')
    },

    // ── 倒角与圆角（P3 面演化评估）──
    chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle {
      void solid; void edges; void distance
      return unsupported('chamfer')
    },
    chamferDistAngle(solid: BrepHandle, edges: BrepHandle[], distance: number, angleDeg: number): BrepHandle {
      void solid; void edges; void distance; void angleDeg
      return unsupported('chamferDistAngle')
    },
    fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle {
      void solid; void edges; void radius
      return unsupported('fillet')
    },
    filletVariable(solid: BrepHandle, edge: BrepHandle, startRadius: number, endRadius: number): BrepHandle {
      void solid; void edge; void startRadius; void endRadius
      return unsupported('filletVariable')
    },
    filletWithHistory(
      solid: BrepHandle, edges: BrepHandle[], radius: number, inputFaceHashes: number[], hashUpperBound: number,
    ): BrepEvolutionData {
      void solid; void edges; void radius; void inputFaceHashes; void hashUpperBound
      return unsupported('filletWithHistory')
    },

    // ── 变换 ──
    translate(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle {
      const p = k.malloc(24)
      try {
        const dv = memOf(k)
        dv.setFloat64(p, dx, true)
        dv.setFloat64(p + 8, dy, true)
        dv.setFloat64(p + 16, dz, true)
        expectOk(k.find('SmApiTranslate')(shape, p), 'translate')
        return shape
      } finally {
        k.free(p)
      }
    },
    scale(shape: BrepHandle, center: BrepVec3, factor: number): BrepHandle {
      const p = k.malloc(48)
      try {
        const dv = memOf(k)
        dv.setFloat64(p, center.x, true)
        dv.setFloat64(p + 8, center.y, true)
        dv.setFloat64(p + 16, center.z, true)
        dv.setFloat64(p + 24, factor, true)
        dv.setFloat64(p + 32, factor, true)
        dv.setFloat64(p + 40, factor, true)
        expectOk(k.find('SmApiScaleByPt')(shape, p, p + 24), 'scale')
        return shape
      } finally {
        k.free(p)
      }
    },
    rotate(shape: BrepHandle, axis: { point: BrepVec3; direction: BrepVec3 }, angleRad: number): BrepHandle {
      // 契约：弧度 → smlib 度（SmApiRotate 第四参为度，头文件实证）。
      const p = k.malloc(56)
      try {
        const dv = memOf(k)
        dv.setFloat64(p, axis.point.x, true)
        dv.setFloat64(p + 8, axis.point.y, true)
        dv.setFloat64(p + 16, axis.point.z, true)
        dv.setFloat64(p + 24, axis.direction.x, true)
        dv.setFloat64(p + 32, axis.direction.y, true)
        dv.setFloat64(p + 40, axis.direction.z, true)
        dv.setFloat64(p + 48, (angleRad * 180) / Math.PI, true)
        expectOk(k.find('SmApiRotate')(shape, p, p + 24, p + 48), 'rotate')
        return shape
      } finally {
        k.free(p)
      }
    },
    copy(shape: BrepHandle): BrepHandle {
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        dv.setUint32(out, 0, true)
        expectOk(k.find('SmApiBrepCopy')(shape, out), 'copy')
        return newSolid(dv.getUint32(out, true))
      } finally {
        k.free(out)
      }
    },
    copyShape(shape: BrepHandle): BrepHandle {
      return primitives.copy(shape)
    },
    composeTransform(m1: number[], m2: number[]): number[] {
      // 3×4 行主序 12 元素：[r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]
      const out = new Array<number>(12).fill(0)
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          out[i * 4 + j] =
            m1[i * 4 + 0] * m2[0 * 4 + j] +
            m1[i * 4 + 1] * m2[1 * 4 + j] +
            m1[i * 4 + 2] * m2[2 * 4 + j]
        }
        out[i * 4 + 3] =
          m1[i * 4 + 0] * m2[0 * 4 + 3] +
          m1[i * 4 + 1] * m2[1 * 4 + 3] +
          m1[i * 4 + 2] * m2[2 * 4 + 3] +
          m1[i * 4 + 3]
      }
      return out
    },
    transform(shape: BrepHandle, matrix: number[]): BrepHandle {
      void shape; void matrix
      return unsupported('transform') // P2：3×4 → SmAxis2Placement 方言
    },
    located(shape: BrepHandle, matrix: number[]): BrepHandle {
      void shape; void matrix
      return unsupported('located')
    },
    locate(shape: BrepHandle, matrix: number[]): BrepHandle {
      void shape; void matrix
      return unsupported('locate')
    },
    generalTransform(shape: BrepHandle, matrix: number[]): BrepHandle {
      void shape; void matrix
      return unsupported('generalTransform')
    },
    mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle {
      void shape; void point; void normal
      return unsupported('mirror')
    },

    // ── 阵列（P2：pattern 族评估）──
    linearPattern(shape: BrepHandle, direction: BrepVec3, spacing: number, count: number): BrepHandle[] {
      void shape; void direction; void spacing; void count
      return unsupported('linearPattern')
    },
    circularPattern(shape: BrepHandle, center: BrepVec3, axis: BrepVec3, angleStep: number, count: number): BrepHandle[] {
      void shape; void center; void axis; void angleStep; void count
      return unsupported('circularPattern')
    },
    gridPattern(
      shape: BrepHandle, directionX: BrepVec3, directionY: BrepVec3, spacingX: number, spacingY: number, countX: number, countY: number,
    ): BrepHandle {
      void shape; void directionX; void directionY; void spacingX; void spacingY; void countX; void countY
      return unsupported('gridPattern')
    },

    // ── 曲线构造（P2：SmApiCurves 接线）──
    makeLineEdge(start: BrepVec3, end: BrepVec3): BrepHandle {
      void start; void end
      return unsupported('makeLineEdge')
    },
    makeArcEdge(start: BrepVec3, mid: BrepVec3, end: BrepVec3): BrepHandle {
      void start; void mid; void end
      return unsupported('makeArcEdge')
    },
    makeBezierEdge(controlPoints: BrepVec3[]): BrepHandle {
      void controlPoints
      return unsupported('makeBezierEdge')
    },
    makeBSplineEdge(
      poles: number[], weights: number[], knots: number[], multiplicities: number[], degree: number, periodic?: boolean,
    ): BrepHandle {
      void poles; void weights; void knots; void multiplicities; void degree; void periodic
      return unsupported('makeBSplineEdge')
    },
    makeCircleEdge(center: BrepVec3, normal: BrepVec3, radius: number): BrepHandle {
      void center; void normal; void radius
      return unsupported('makeCircleEdge')
    },
    makeCircleArc(center: BrepVec3, normal: BrepVec3, radius: number, startAngle: number, endAngle: number): BrepHandle {
      void center; void normal; void radius; void startAngle; void endAngle
      return unsupported('makeCircleArc')
    },
    makeHelixWire(
      origin: BrepVec3, axis: BrepVec3, pitch: number, height: number, radius: number, leftHanded?: boolean,
    ): BrepHandle {
      void origin; void axis; void pitch; void height; void radius; void leftHanded
      return unsupported('makeHelixWire')
    },
    approximatePoints(points: BrepVec3[], tolerance?: number): BrepHandle {
      void points; void tolerance
      return unsupported('approximatePoints')
    },
    interpolatePointsWithTangents(points: BrepVec3[], startTangent: BrepVec3, endTangent: BrepVec3): BrepHandle {
      void points; void startTangent; void endTangent
      return unsupported('interpolatePointsWithTangents')
    },
    curveSplit(edge: BrepHandle, param: number): [BrepHandle, BrepHandle] {
      void edge; void param
      return unsupported('curveSplit')
    },

    // ── 拓扑构造（P2：wire/face 评估）──
    makeWire(edges: BrepHandle[]): BrepHandle {
      void edges
      return unsupported('makeWire')
    },
    makeFace(wire: BrepHandle): BrepHandle {
      void wire
      return unsupported('makeFace')
    },
    makeCompound(shapes: BrepHandle[]): BrepHandle {
      void shapes
      return unsupported('makeCompound')
    },
    addHolesInFace(face: BrepHandle, holeWires: BrepHandle[]): BrepHandle {
      void face; void holeWires
      return unsupported('addHolesInFace')
    },
    buildTriFace(a: BrepVec3, b: BrepVec3, c: BrepVec3): BrepHandle {
      void a; void b; void c
      return unsupported('buildTriFace')
    },
    makeNonPlanarFace(wire: BrepHandle): BrepHandle {
      void wire
      return unsupported('makeNonPlanarFace')
    },

    // ── 三角化（BREP→mesh 唯一出口）──
    meshShape(shape: BrepHandle, options?: BrepTessellateOptions): BrepMeshResult {
      // SmApiTessellateEx(pBrep, pParams, pStatus) → 单块 malloc 缓冲：
      //   u32[3] header {numVerts, numTris, numFaces}
      //   f32 verts[3V] / normals[3V]（V=3T 独立三角形，flat 面法向）
      //   u32 indices[3T]（0..V-1 顺序）
      //   u32 faceGroups[3F] = {triStart, triCount, facePtr}（facePtr=SmFace*）
      // 选项：linearDeflection→dChordHeightTol、angularDeflection→dCurveAngleTolDeg
      //（度换算），0 = 内核默认（SmTessellationDefaults）。
      void options
      const status = k.malloc(4)
      const buf = k.find('SmApiTessellateEx')(shape, 0, status)
      try {
        const dv = memOf(k)
        expectOk(dv.getUint32(status, true), 'meshShape')
        if (!buf) throw new Error('[smlib-kernel] meshShape: bridge returned null buffer')
        const u32 = new Uint32Array(k.memory.buffer, buf, 3)
        const numVerts = u32[0]
        const numTris = u32[1]
        const numFaces = u32[2]
        const verts = new Float32Array(k.memory.buffer, buf + 12, numVerts * 3)
        const normals = new Float32Array(k.memory.buffer, buf + 12 + numVerts * 12, numVerts * 3)
        const idxOff = buf + 12 + numVerts * 24
        const indices = new Uint32Array(k.memory.buffer, idxOff, numTris * 3)
        const fgOff = idxOff + numTris * 12
        const fg = new Uint32Array(k.memory.buffer, fgOff, numFaces * 3)

        // faceGroups 映射：桥输出每三角形一个组（facePtr 成对相同）→ 按 facePtr 合并
        // 为面组 [triStart, triCount, faceHash]，前两元换算为**索引单位**（×3）。
        const merged: { triStart: number; triCount: number; hash: number }[] = []
        for (let i = 0; i < numFaces; i++) {
          const triStart = fg[i * 3]
          const triCount = fg[i * 3 + 1]
          const facePtr = fg[i * 3 + 2]
          const hash = subShapeHashOf(facePtr, BREP_HASH_BOUND)
          const last = merged[merged.length - 1]
          if (last && last.hash === hash) {
            last.triCount += triCount
          } else {
            merged.push({ triStart, triCount, hash })
          }
        }
        const faceGroups = new Int32Array(merged.length * 3)
        for (let i = 0; i < merged.length; i++) {
          faceGroups[i * 3] = merged[i].triStart * 3 // 索引单位
          faceGroups[i * 3 + 1] = merged[i].triCount * 3
          faceGroups[i * 3 + 2] = merged[i].hash
        }
        return {
          positions: verts,
          normals,
          indices,
          vertexCount: numVerts,
          triangleCount: numTris,
          faceGroups,
          faceCount: merged.length,
        }
      } finally {
        k.free(status)
        if (buf) k.free(buf)
      }
    },
    wireframe(shape: BrepHandle, deflection?: number): BrepEdgeData {
      // SmApiTessellateBoundariesEx(pBrep, dAngleTolDeg, pStatus) → 单块缓冲：
      //   u32[2] {numEdges, numPoints} + f64[3N] points + u32[N] counts + u32[N] edges
      const status = k.malloc(4)
      const buf = k.find('SmApiTessellateBoundariesEx')(shape, deflection ?? 5, status)
      try {
        const dv = memOf(k)
        expectOk(dv.getUint32(status, true), 'wireframe')
        if (!buf) throw new Error('[smlib-kernel] wireframe: bridge returned null buffer')
        const u32 = new Uint32Array(k.memory.buffer, buf, 2)
        const numEdges = u32[0]
        const numPoints = u32[1]
        const ptsF64 = new Float64Array(k.memory.buffer, buf + 8, numPoints * 3)
        const points = new Float32Array(numPoints * 3)
        for (let i = 0; i < numPoints * 3; i++) points[i] = ptsF64[i]
        const countsOff = buf + 8 + numPoints * 24
        const counts = new Uint32Array(k.memory.buffer, countsOff, numEdges)
        const edgesOff = countsOff + numEdges * 4
        const edges = new Uint32Array(k.memory.buffer, edgesOff, numEdges)

        // edgeGroups：[pointStart, pointCount, edgeHash]，前两元为**浮点单位**（×3）。
        const edgeGroups = new Int32Array(numEdges * 3)
        let pointStart = 0
        for (let i = 0; i < numEdges; i++) {
          const count = counts[i]
          edgeGroups[i * 3] = pointStart * 3
          edgeGroups[i * 3 + 1] = count * 3
          edgeGroups[i * 3 + 2] = subShapeHashOf(edges[i], BREP_HASH_BOUND)
          pointStart += count
        }
        return { points, edgeGroups, pointCount: numPoints * 3, edgeCount: numEdges }
      } finally {
        k.free(status)
        if (buf) k.free(buf)
      }
    },

    // ── 拓扑查询 ──
    getSubShapes(shape: BrepHandle, type: BrepSubShapeType): BrepHandle[] {
      const count = k.malloc(4)
      try {
        const dv = memOf(k)
        if (type === 'solid') {
          // P1：无 compound/嵌套实体——SmBrep 自身的子实体就是自己。
          if (solidHandles.has(shape as number)) return [shape]
          return unsupported(`getSubShapes(${type})`)
        }
        if (type === 'shell') {
          // P1 占位：solid 当唯一 shell（shell 句柄后续查询 face/edge 走 solid 分支）。
          if (solidHandles.has(shape as number)) return [shape]
          return unsupported(`getSubShapes(${type})`)
        }
        if (type === 'edge' && !solidHandles.has(shape as number)) {
          // face→edge：SmApiFaceBoundaryLoopsEx（面边按 loop 展平，seam 重复保留）。
          const pOut = k.malloc(4)
          dv.setUint32(pOut, 0, true)
          try {
            const st = k.find('SmApiFaceBoundaryLoopsEx')(shape, pOut)
            if (st !== SM_SUCCESS) throw new Error(`[smlib-kernel] getSubShapes(edge): bridge failed (st=${st})`)
            const buf = dv.getUint32(pOut, true)
            if (!buf) throw new Error(`[smlib-kernel] getSubShapes(edge): bridge failed (buf=0)`)
            try {
              const u32 = new Uint32Array(k.memory.buffer, buf, 3)
              const numLoops = u32[0]
              const numOcc = u32[2]
              const edges = new Uint32Array(k.memory.buffer, buf + 12 + numLoops * 4, numOcc)
              return Array.from(edges, (p) => p as BrepHandle)
            } finally {
              k.free(buf)
            }
          } finally {
            k.free(pOut)
          }
        }
        const bridge = type === 'face' ? 'SmApiGetFacesEx' : type === 'edge' ? 'SmApiGetEdgesEx' : null
        if (!bridge) return unsupported(`getSubShapes(${type})`)
        const st = k.find(bridge)(shape, count)
        const n = dv.getUint32(count, true)
        const arr = st
        if (!arr) throw new Error(`[smlib-kernel] getSubShapes(${type}): bridge failed (n=${n}, shape=${shape})`)
        try {
          const ptrs = new Uint32Array(k.memory.buffer, arr, n)
          return Array.from(ptrs, (p) => p as BrepHandle)
        } finally {
          k.free(arr)
        }
      } finally {
        k.free(count)
      }
    },
    subShapeHashes(shape: BrepHandle, type: BrepSubShapeType, hashUpperBound: number): number[] {
      // 与 meshShape faceGroups 同源：同一 SmFace*/SmEdge* 指针 → 同一 hash。
      return primitives.getSubShapes(shape, type).map((h) => subShapeHashOf(h as unknown as number, hashUpperBound))
    },
    hashCode(shape: BrepHandle, upperBound: number): number {
      // smlib 无通用形状 hash；用句柄指针取模（与子形状 hash 同族）。
      return subShapeHashOf(shape as unknown as number, upperBound)
    },
    isSame(a: BrepHandle, b: BrepHandle): boolean {
      return a === b
    },
    isSolid(shape: BrepHandle): boolean {
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        expectOk(k.find('SmApiBrepIsManifoldSolid')(shape, out), 'isSolid')
        return dv.getUint32(out, true) !== 0
      } finally {
        k.free(out)
      }
    },
    subShapeCount(shape: BrepHandle, type: BrepSubShapeType): number {
      return primitives.getSubShapes(shape, type).length
    },
    shapeType(shape: BrepHandle): string {
      // smlib 句柄是裸指针，无原生类型判别；登记表只能判 solid。
      // P2 引入句柄类型标签（高位）后补 face/edge/wire 判别。
      if (solidHandles.has(shape as unknown as number)) return 'SOLID'
      return unsupported('shapeType(non-solid)')
    },
    shapeOrientation(shape: BrepHandle): string {
      void shape
      return unsupported('shapeOrientation')
    },
    edgeToFaceMap(shape: BrepHandle): unknown {
      void shape
      return unsupported('edgeToFaceMap')
    },
    adjacentFaces(shape: BrepHandle, face: BrepHandle): BrepHandle[] {
      void shape; void face
      return unsupported('adjacentFaces')
    },
    sharedEdges(a: BrepHandle, b: BrepHandle): BrepHandle[] {
      void a; void b
      return unsupported('sharedEdges')
    },

    // ── 几何求值（P2：SmApiCurves/Surfaces 接线）──
    curveType(edge: BrepHandle): string {
      const out = k.malloc(4)
      try {
        expectOk(k.find('SmApiCurveTypeEx')(edge, out), 'curveType')
        const code = memOf(k).getUint32(out, true)
        return code === 0 ? 'line' : code === 1 ? 'circle' : code === 2 ? 'ellipse' : code === 3 ? 'bspline' : 'other'
      } finally {
        k.free(out)
      }
    },
    curvePointAtParam(edge: BrepHandle, param: number): BrepVec3 {
      const p = k.malloc(24)
      try {
        const dv = memOf(k)
        expectOk(k.find('SmApiCurvePointAtParamEx')(edge, param, p), 'curvePointAtParam')
        return { x: dv.getFloat64(p, true), y: dv.getFloat64(p + 8, true), z: dv.getFloat64(p + 16, true) }
      } finally {
        k.free(p)
      }
    },
    curveTangent(edge: BrepHandle, param: number): BrepVec3 {
      const p = k.malloc(24)
      try {
        const dv = memOf(k)
        expectOk(k.find('SmApiCurveTangentEx')(edge, param, p), 'curveTangent')
        return { x: dv.getFloat64(p, true), y: dv.getFloat64(p + 8, true), z: dv.getFloat64(p + 16, true) }
      } finally {
        k.free(p)
      }
    },
    curveParameters(edge: BrepHandle): BrepCurveParameters {
      const p = k.malloc(16)
      try {
        const dv = memOf(k)
        expectOk(k.find('SmApiCurveParametersEx')(edge, p), 'curveParameters')
        return { first: dv.getFloat64(p, true), last: dv.getFloat64(p + 8, true) }
      } finally {
        k.free(p)
      }
    },
    curveIsClosed(edge: BrepHandle): boolean {
      const out = k.malloc(4)
      try {
        expectOk(k.find('SmApiCurveIsClosedEx')(edge, out), 'curveIsClosed')
        return memOf(k).getUint32(out, true) === 1
      } finally {
        k.free(out)
      }
    },
    curveLength(edge: BrepHandle): number {
      const p = k.malloc(8)
      try {
        expectOk(k.find('SmApiCurveLengthEx')(edge, p), 'curveLength')
        return memOf(k).getFloat64(p, true)
      } finally {
        k.free(p)
      }
    },
    surfaceType(face: BrepHandle): string {
      // 命名系统依赖（box 命名/选择器/评分都读它）：桥 dynamic_cast 判别。
      // 类型码：0=plane 1=cylinder 2=cone 3=sphere 4=torus 5=bspline 6=other。
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        const st = k.find('SmApiSurfaceTypeEx')(face, out)
        expectOk(st, 'surfaceType')
        switch (dv.getUint32(out, true)) {
          case 0: return 'plane'
          case 1: return 'cylinder'
          case 2: return 'cone'
          case 3: return 'sphere'
          case 4: return 'torus'
          case 5: return 'bspline'
          default: return 'other'
        }
      } finally {
        k.free(out)
      }
    },
    surfaceNormal(face: BrepHandle, u: number, v: number): BrepVec3 {
      const p = k.malloc(24)
      try {
        const dv = memOf(k)
        expectOk(k.find('SmApiSurfaceNormalEx')(face, u, v, p), 'surfaceNormal')
        return { x: dv.getFloat64(p, true), y: dv.getFloat64(p + 8, true), z: dv.getFloat64(p + 16, true) }
      } finally {
        k.free(p)
      }
    },
    pointOnSurface(face: BrepHandle, u: number, v: number): BrepVec3 {
      const p = k.malloc(24)
      try {
        const dv = memOf(k)
        expectOk(k.find('SmApiPointOnSurfaceEx')(face, u, v, p), 'pointOnSurface')
        return { x: dv.getFloat64(p, true), y: dv.getFloat64(p + 8, true), z: dv.getFloat64(p + 16, true) }
      } finally {
        k.free(p)
      }
    },
    uvBounds(face: BrepHandle): BrepUvBounds {
      const p = k.malloc(32)
      try {
        const dv = memOf(k)
        expectOk(k.find('SmApiFaceUvBoundsEx')(face, p), 'uvBounds')
        return {
          uMin: dv.getFloat64(p, true),
          uMax: dv.getFloat64(p + 8, true),
          vMin: dv.getFloat64(p + 16, true),
          vMax: dv.getFloat64(p + 24, true),
        }
      } finally {
        k.free(p)
      }
    },
    surfaceCenterOfMass(face: BrepHandle): BrepVec3 {
      // SmApiFaceComputeCentroid(pFace, acc, rdArea&, rCentroid&)。
      const p = k.malloc(40) // acc(8) + area(8) + centroid(24)
      try {
        const dv = memOf(k)
        dv.setFloat64(p, 1e-4, true)
        expectOk(k.find('SmApiFaceComputeCentroid')(face, p, p + 8, p + 16), 'surfaceCenterOfMass')
        return { x: dv.getFloat64(p + 16, true), y: dv.getFloat64(p + 24, true), z: dv.getFloat64(p + 32, true) }
      } finally {
        k.free(p)
      }
    },
    vertexPosition(vertex: BrepHandle): BrepVec3 {
      // P2：SmApiVertexGetPoint。P1 桩。
      void vertex
      return unsupported('vertexPosition')
    },
    containsPoint(shape: BrepHandle, point: BrepVec3, tolerance: number): boolean {
      void shape; void point; void tolerance
      return unsupported('containsPoint')
    },
    getFaceCylinderData(face: BrepHandle): { radius: number } | null {
      void face
      return unsupported('getFaceCylinderData')
    },
    getNurbsCurveData(edge: BrepHandle): BrepNurbsCurveData | null {
      void edge
      return unsupported('getNurbsCurveData')
    },
    interpolatePoints(points: BrepVec3[], degree: number): BrepHandle {
      void points; void degree
      return unsupported('interpolatePoints')
    },
    defeature(shape: BrepHandle, faces: BrepHandle[]): BrepHandle {
      void shape; void faces
      return unsupported('defeature')
    },
    draft(shape: BrepHandle, faces: BrepHandle[], pull: BrepVec3, neutral: BrepVec3, angleDeg: number): BrepHandle {
      void shape; void faces; void pull; void neutral; void angleDeg
      return unsupported('draft')
    },
    removeHolesFromFace(face: BrepHandle): BrepHandle {
      void face
      return unsupported('removeHolesFromFace')
    },
    reverseShape(shape: BrepHandle): BrepHandle {
      void shape
      return unsupported('reverseShape')
    },
    projectEdges(shape: BrepHandle, origin: BrepVec3, direction: BrepVec3, xAxis: BrepVec3, hiddenLines: boolean, deflection: number): unknown {
      void shape; void origin; void direction; void xAxis; void hiddenLines; void deflection
      return unsupported('projectEdges')
    },

    // ── 测量 ──
    getBoundingBox(shape: BrepHandle, useTriangulation?: boolean): BrepBoundingBox {
      // bTight：useTriangulation=false（缺省）→ loose box（bTight=0）。
      const p = k.malloc(48)
      try {
        const dv = memOf(k)
        expectOk(k.find('SmApiBrepBoundingBox')(shape, useTriangulation ? 1 : 0, p, p + 24), 'getBoundingBox')
        return {
          xmin: dv.getFloat64(p, true),
          ymin: dv.getFloat64(p + 8, true),
          zmin: dv.getFloat64(p + 16, true),
          xmax: dv.getFloat64(p + 24, true),
          ymax: dv.getFloat64(p + 32, true),
          zmax: dv.getFloat64(p + 40, true),
        }
      } finally {
        k.free(p)
      }
    },
    getVolume(shape: BrepHandle): number {
      const p = k.malloc(8)
      try {
        expectOk(k.find('SmApiBrepComputeVolume')(shape, 1e-8, p), 'getVolume')
        return memOf(k).getFloat64(p, true)
      } finally {
        k.free(p)
      }
    },
    getCenterOfMass(shape: BrepHandle): BrepVec3 {
      // SmApiBrepComputeMassProperties(brep, acc, density, origin, area&, vol&, mass&,
      //   centroid&, moments&, products&)——centroid 是 world 坐标（独立于 origin）。
      const inP = k.malloc(48) // acc(8) + density(8) + origin(24) + 保留
      const outP = k.malloc(96) // area+vol+mass(24) + centroid(24) + moments(24) + products(24)
      try {
        const dv = memOf(k)
        dv.setFloat64(inP, 1e-4, true) // dRelativeAccuracy ∈ [1e-4, 1e-1]
        dv.setFloat64(inP + 8, 1, true) // density
        dv.setFloat64(inP + 16, 0, true)
        dv.setFloat64(inP + 24, 0, true)
        dv.setFloat64(inP + 32, 0, true)
        expectOk(
          k.find('SmApiBrepComputeMassProperties')(shape, inP, inP + 8, inP + 16, outP, outP + 8, outP + 16, outP + 24, outP + 48, outP + 72),
          'getCenterOfMass',
        )
        return { x: dv.getFloat64(outP + 24, true), y: dv.getFloat64(outP + 32, true), z: dv.getFloat64(outP + 40, true) }
      } finally {
        k.free(inP)
        k.free(outP)
      }
    },
    getSurfaceArea(shape: BrepHandle): number {
      const p = k.malloc(8)
      try {
        expectOk(k.find('SmApiBrepComputeArea')(shape, 1e-8, p), 'getSurfaceArea')
        return memOf(k).getFloat64(p, true)
      } finally {
        k.free(p)
      }
    },
    getLength(shape: BrepHandle): number {
      void shape
      return unsupported('getLength') // P2：SmApiEdgeComputeLength
    },

    // ── 校验与修复 ──
    isValid(shape: BrepHandle): boolean {
      // smlib 无通用 validity 查询；P1 以 IsManifoldSolid 近似（可对齐 occt
      // CheckShape 的"闭合流形"面；缝隙/自交等深校验 P2 评估）。
      return primitives.isSolid(shape)
    },
    unifySameDomain(shape: BrepHandle): BrepHandle {
      void shape
      return unsupported('unifySameDomain')
    },
    healSolid(shape: BrepHandle, tolerance?: number): BrepHandle {
      void shape; void tolerance
      return unsupported('healSolid')
    },
    fixShape(shape: BrepHandle): BrepHandle {
      void shape
      return unsupported('fixShape')
    },
    fixFaceOrientations(shape: BrepHandle): BrepHandle {
      void shape
      return unsupported('fixFaceOrientations')
    },
    removeDegenerateEdges(shape: BrepHandle, tolerance?: number): BrepHandle {
      void shape; void tolerance
      return unsupported('removeDegenerateEdges')
    },

    // ── IO（P5 独立立项：无 STEP/STL IO 是重大缺口）──
    importStep(data: string | ArrayBuffer): BrepHandle {
      void data
      return unsupported('importStep')
    },
    exportStep(shape: BrepHandle): string {
      void shape
      return unsupported('exportStep')
    },
    importStl(data: string | ArrayBuffer): BrepHandle {
      void data
      return unsupported('importStl')
    },
    fromBREP(data: string): BrepHandle {
      void data
      return unsupported('fromBREP')
    },

    // ── 面演化（P3）──
    cutWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      void a; void b; void inputFaceHashes; void hashUpperBound
      return unsupported('cutWithHistory')
    },
    fuseWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      void a; void b; void inputFaceHashes; void hashUpperBound
      return unsupported('fuseWithHistory')
    },
    intersectWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      void a; void b; void inputFaceHashes; void hashUpperBound
      return unsupported('intersectWithHistory')
    },
  }

  primitivesSingleton = primitives
  return primitives
}

/** 返回已就绪的 smlib 原语集合（未初始化则抛错）。
 * @returns 已初始化的 smlib 内核实例。 */
export function getSmlibKernel(): SmlibPrimitives {
  if (!primitivesSingleton) throw new Error('[smlib-kernel] smlib primitives not initialized: call createSmlibPrimitives() first')
  return primitivesSingleton
}

/** 释放全部登记句柄并重置内核（对齐 brepkit disposeBrekit 收尾路径）。 */
export function disposeSmlib(): void {
  if (primitivesSingleton) {
    primitivesSingleton.dispose()
  }
  primitivesSingleton = null
  resetSmlibWasm()
}
