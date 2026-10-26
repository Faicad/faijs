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

// ── P2 辅助：wire 合成句柄 + 边→曲线提取 ──
//
// smlib 无独立 wire 类型（SmApiOrderCurves 重排的是曲线数组）。L1 的
// makeWire 返回"wire 句柄"供 makeFace/loft/addHolesInFace 复用——适配器用
// 合成句柄（高位 tag 远在 wasm 堆指针范围之上，永不撞）登记曲线句柄数组。
const WIRE_TAG = 0x200000000 // 8GB 边界（wasm 最大 4GB，指针 < 0x100000000）
let nextWireId = 1
const wireHandles = new Map<number, number[]>()

// 合成顶点句柄（P2 顶点枚举）：坐标去重后登记，vertexPosition 查表。
const VERTEX_TAG = 0x300000000
let nextVertexId = 1
const vertexHandles = new Map<number, BrepVec3>()

/** 构造 wire 合成句柄并登记曲线数组。 */
function newWire(curves: number[]): BrepHandle {
  const handle = WIRE_TAG + nextWireId++
  wireHandles.set(handle, curves)
  return handle as BrepHandle
}

/** 边/曲线句柄 → 曲线句柄（SmEdge* → GetCurve()，裸曲线原样返回）。 */
function edgeToCurve(k: SmlibKernel, handle: number): number {
  const out = k.malloc(4)
  try {
    const dv = memOf(k)
    dv.setUint32(out, 0, true)
    expectOk(k.find('SmApiEdgeToCurveEx')(handle, out), 'edgeToCurve')
    return dv.getUint32(out, true)
  } finally {
    k.free(out)
  }
}

/** 面外环边 → 曲线句柄数组（BoundaryLoopsEx 第一环；seam 重复已由环序剔除）。
 *  输入是 face 句柄或（单面）brep 句柄——后者先取 GetFacesEx 第一面。 */
function faceOuterCurves(k: SmlibKernel, face: number): number[] {
  let facePtr = face
  if (solidHandles.has(face)) {
    // makeRectangle/CreatePlanarFaces 返回的是（单面）brep：取第一面。
    const pCount = k.malloc(4)
    try {
      const dv = memOf(k)
      const arr = k.find('SmApiGetFacesEx')(face, pCount)
      const n = dv.getUint32(pCount, true)
      if (!arr || n === 0) throw new Error('[smlib-kernel] faceOuterCurves: no faces in brep')
      try {
        facePtr = new Uint32Array(k.memory.buffer, arr, n)[0]
      } finally {
        k.free(arr)
      }
    } finally {
      k.free(pCount)
    }
  }
  const pOut = k.malloc(4)
  try {
    const dv = memOf(k)
    dv.setUint32(pOut, 0, true)
    expectOk(k.find('SmApiFaceBoundaryLoopsEx')(facePtr, pOut), 'faceOuterCurves')
    const buf = dv.getUint32(pOut, true)
    if (!buf) throw new Error('[smlib-kernel] faceOuterCurves: bridge returned buf=0')
    try {
      const u32 = new Uint32Array(k.memory.buffer, buf, 3)
      const numLoops = u32[0]
      const firstLoopCount = numLoops > 0 ? new Uint32Array(k.memory.buffer, buf + 12, 1)[0] : 0
      if (numLoops === 0 || firstLoopCount === 0) return []
      const edges = new Uint32Array(k.memory.buffer, buf + 12 + numLoops * 4, firstLoopCount)
      return Array.from(edges, (e) => edgeToCurve(k, e))
    } finally {
      k.free(buf)
    }
  } finally {
    k.free(pOut)
  }
}

/** BrepVec3[] → malloc f64[3N]（返回 {ptr, dv}；调用方负责 free）。 */
function ptsToMemory(k: SmlibKernel, points: BrepVec3[]): { ptr: number; dv: DataView } {
  const ptr = k.malloc(points.length * 24)
  const dv = memOf(k)
  for (let i = 0; i < points.length; i++) {
    dv.setFloat64(ptr + i * 24, points[i].x, true)
    dv.setFloat64(ptr + i * 24 + 8, points[i].y, true)
    dv.setFloat64(ptr + i * 24 + 16, points[i].z, true)
  }
  return { ptr, dv }
}

/** 单位化向量。 */
function normVec(v: BrepVec3): BrepVec3 {
  const len = Math.hypot(v.x, v.y, v.z)
  if (len === 0) throw new Error('[smlib-kernel] zero-length vector')
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/** 叉积。 */
function cross(a: BrepVec3, b: BrepVec3): BrepVec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

/** 点积。 */
function dot(a: BrepVec3, b: BrepVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * 构造把"XY 平面曲线（CreateCircle/CreateArc 输出，圆心在原点）"变换到
 * "center + normal 局部平面"的 3×4 行主序矩阵（局部 X = normal×Z 或 normal×X 兜底）。
 */
function circlePlacementMatrix(center: BrepVec3, normal: BrepVec3): number[] {
  const n = normVec(normal)
  let u: BrepVec3
  if (Math.abs(n.z) < 0.999) u = normVec(cross(n, { x: 0, y: 0, z: 1 }))
  else u = normVec(cross(n, { x: 1, y: 0, z: 0 }))
  const v = cross(n, u)
  // 行主序 [r00 r01 r02 tx | r10 r11 r12 ty | r20 r21 r22 tz]：
  // 列向量 = [u v n]，平移 = center。
  return [u.x, v.x, n.x, center.x, u.y, v.y, n.y, center.y, u.z, v.z, n.z, center.z]
}

/** 曲线句柄数组 → SmApiCreatePlanarFacesEx → 新 brep（登记 solid）。 */
function createPlanarFaces(k: SmlibKernel, curves: number[]): BrepHandle {
  const arr = k.malloc(4 * curves.length)
  const out = k.malloc(4)
  try {
    const dv = memOf(k)
    curves.forEach((c, i) => dv.setUint32(arr + i * 4, c, true))
    dv.setUint32(out, 0, true)
    expectOk(k.find('SmApiCreatePlanarFacesEx')(arr, curves.length, out), 'createPlanarFaces')
    return newSolid(dv.getUint32(out, true))
  } finally {
    k.free(arr)
    k.free(out)
  }
}

/** 3×4 行主序矩阵 → SmApiTransformMatrixEx（原地变换并返回原句柄）。 */
function applyMatrix(k: SmlibKernel, shape: BrepHandle, matrix: number[], what: string): BrepHandle {
  if (matrix.length !== 12) throw new Error(`[smlib-kernel] ${what}: matrix must be 12 elements (3×4 row-major)`)
  const m = k.malloc(96)
  const st = k.malloc(4)
  try {
    const dv = memOf(k)
    for (let i = 0; i < 12; i++) dv.setFloat64(m + i * 8, matrix[i], true)
    expectOk(k.find('SmApiTransformMatrixEx')(shape, m, st), what)
    return shape
  } finally {
    k.free(m)
    k.free(st)
  }
}

/** 三点圆弧：外接圆圆心 + 起止角 → CreateArc（XY）→ 变换到三点平面。 */
function threePointArc(k: SmlibKernel, start: BrepVec3, mid: BrepVec3, end: BrepVec3): BrepHandle {
  const a = start
  const b = mid
  const c = end
  // 外接圆圆心（三点不共线）。
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
  const n = cross(ab, ac)
  const nLen = Math.hypot(n.x, n.y, n.z)
  if (nLen < 1e-12) throw new Error('[smlib-kernel] threePointArc: collinear points')
  const d = 2 * dot(ab, ac)
  const ab2 = dot(ab, ab)
  const ac2 = dot(ac, ac)
  // 三点不共线由 nLen 保证；d（=2ab·ac）可为 0（ab⊥ac），不是退化条件。
  void d
  // 标准外接圆：center = a + α·ab + β·ac，
  // (center−a)·ab = |ab|²/2， (center−a)·ac = |ac|²/2。
  const m11 = ab2
  const m12 = dot(ab, ac)
  const m21 = m12
  const m22 = ac2
  const det = m11 * m22 - m12 * m21
  if (Math.abs(det) < 1e-18) throw new Error('[smlib-kernel] threePointArc: degenerate (zero plane area)')
  const alpha = (ab2 / 2 * m22 - ac2 / 2 * m12) / det
  const beta = (ac2 / 2 * m11 - ab2 / 2 * m21) / det
  const center = { x: a.x + alpha * ab.x + beta * ac.x, y: a.y + alpha * ab.y + beta * ac.y, z: a.z + alpha * ab.z + beta * ac.z }
  const r = Math.hypot(center.x - a.x, center.y - a.y, center.z - a.z)
  // 局部基：u = (a−center)/r，v = n×u，w = n。
  const u = { x: (a.x - center.x) / r, y: (a.y - center.y) / r, z: (a.z - center.z) / r }
  const w = { x: n.x / nLen, y: n.y / nLen, z: n.z / nLen }
  const v = cross(w, u)
  const ang = (p: BrepVec3): number => {
    const dx = p.x - center.x
    const dy = p.y - center.y
    const dz = p.z - center.z
    return (Math.atan2(dx * v.x + dy * v.y + dz * v.z, dx * u.x + dy * u.y + dz * u.z) * 180) / Math.PI
  }
  const a0 = ang(a)
  let a1 = ang(c)
  // 保证过 mid：若 a1−a0 与 mid 角向不一致则补 360。
  const am = ang(b)
  if ((a1 - a0) > 0 !== (am - a0) > 0 && Math.abs(a1 - a0) > 1e-9) {
    a1 += a1 - a0 > 0 ? -360 : 360
  }
  const out = k.malloc(4)
  const p = k.malloc(24)
  try {
    const dv = memOf(k)
    dv.setFloat64(p, 0, true)
    dv.setFloat64(p + 8, 0, true)
    dv.setFloat64(p + 16, 0, true)
    dv.setUint32(out, 0, true)
    expectOk(k.find('SmApiCreateArc')(p, r, a0, a1, out), 'makeArcEdge')
    const curve = dv.getUint32(out, true)
    // 变换到三点平面：局部基 [u v w] 列向量 + 平移 center。
    const m = [u.x, v.x, w.x, center.x, u.y, v.y, w.y, center.y, u.z, v.z, w.z, center.z]
    applyMatrix(k, curve as BrepHandle, m, 'makeArcEdge:place')
    return curve as BrepHandle
  } finally {
    k.free(out)
    k.free(p)
  }
}

/** SmApiCreateCanonicalCurveEx 包装（makeBezierEdge/makeBSplineEdge 共用）。 */
function createCanonicalCurve(
  k: SmlibKernel,
  points: BrepVec3[],
  knots: number[],
  mults: number[],
  weights: number[] | undefined,
  degree: number,
): BrepHandle {
  const p = ptsToMemory(k, points)
  const knotBuf = k.malloc(8 * knots.length)
  const multBuf = k.malloc(4 * mults.length)
  const wBuf = weights && weights.length > 0 ? k.malloc(8 * weights.length) : 0
  const out = k.malloc(4)
  try {
    const dv = memOf(k)
    knots.forEach((x, i) => dv.setFloat64(knotBuf + i * 8, x, true))
    mults.forEach((x, i) => dv.setUint32(multBuf + i * 4, x, true))
    if (wBuf) weights!.forEach((x, i) => dv.setFloat64(wBuf + i * 8, x, true))
    dv.setUint32(out, 0, true)
    expectOk(
      k.find('SmApiCreateCanonicalCurveEx')(
        p.ptr, points.length, knotBuf, knots.length, multBuf, mults.length, wBuf, wBuf ? weights!.length : 0, degree, 6, out,
      ),
      'createCanonicalCurve',
    )
    return dv.getUint32(out, true) as BrepHandle
  } finally {
    k.free(p.ptr)
    if (wBuf) k.free(wBuf)
    k.free(knotBuf)
    k.free(multBuf)
    k.free(out)
  }
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
      // P2：4 条线段环 → SmApiCreatePlanarFacesEx（XY 平面，左下角在原点）。
      const pts: BrepVec3[] = [
        { x: 0, y: 0, z: 0 },
        { x: width, y: 0, z: 0 },
        { x: width, y: height, z: 0 },
        { x: 0, y: height, z: 0 },
      ]
      const curves: number[] = []
      for (let i = 0; i < 4; i++) {
        const p = ptsToMemory(k, [pts[i], pts[(i + 1) % 4]])
        try {
          const out = k.malloc(4)
          try {
            const dv = memOf(k)
            dv.setUint32(out, 0, true)
            expectOk(k.find('SmApiCreateLineSegment')(p.ptr, p.ptr + 24, out), 'makeRectangle:line')
            curves.push(dv.getUint32(out, true))
          } finally {
            k.free(out)
          }
        } finally {
          k.free(p.ptr)
        }
      }
      return createPlanarFaces(k, curves)
    },
    makeEllipsoid(rx: number, ry: number, rz: number): BrepHandle {
      // C 缺口：SmApiCreateEllipse 是平面椭圆曲线，非椭球体。显式失败（§5.6）。
      void rx; void ry; void rz
      return unsupported('makeEllipsoid')
    },
    makeVertex(x: number, y: number, z: number): BrepHandle {
      // C 缺口：SM_API 无顶点构造原语（SmApiVertexGetPoint 是查询）。显式失败。
      void x; void y; void z
      return unsupported('makeVertex')
    },

    // ── 造型运算 ──
    extrude(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle {
      // B：face → 外环曲线数组 → SmApiCreateLinearSweepEx（方向 + 距离 + 封盖）。
      const curves = faceOuterCurves(k, shape as unknown as number)
      if (curves.length === 0) throw new Error('[smlib-kernel] extrude: no outer-loop curves')
      const dir = k.malloc(24)
      const arr = k.malloc(4 + curves.length * 4)
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        dv.setFloat64(dir, dx, true)
        dv.setFloat64(dir + 8, dy, true)
        dv.setFloat64(dir + 16, dz, true)
        dv.setUint32(out, 0, true)
        curves.forEach((c, i) => dv.setUint32(arr + i * 4, c, true))
        const dist = Math.hypot(dx, dy, dz)
        expectOk(
          k.find('SmApiCreateLinearSweepEx')(arr, curves.length, dir, dist, 1, out),
          'extrude',
        )
        return newSolid(dv.getUint32(out, true))
      } finally {
        k.free(dir)
        k.free(arr)
        k.free(out)
      }
    },
    revolveVec(shape: BrepHandle, center: BrepVec3, direction: BrepVec3, angleDeg: number): BrepHandle {
      // B：face → 外环曲线 → SmApiCreateRotationalSweepEx（角度制直通）。
      const curves = faceOuterCurves(k, shape as unknown as number)
      if (curves.length === 0) throw new Error('[smlib-kernel] revolveVec: no outer-loop curves')
      const base = k.malloc(24)
      const axis = k.malloc(24)
      const arr = k.malloc(4 + curves.length * 4)
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        dv.setFloat64(base, center.x, true)
        dv.setFloat64(base + 8, center.y, true)
        dv.setFloat64(base + 16, center.z, true)
        dv.setFloat64(axis, direction.x, true)
        dv.setFloat64(axis + 8, direction.y, true)
        dv.setFloat64(axis + 16, direction.z, true)
        dv.setUint32(out, 0, true)
        curves.forEach((c, i) => dv.setUint32(arr + i * 4, c, true))
        expectOk(
          k.find('SmApiCreateRotationalSweepEx')(arr, curves.length, base, axis, angleDeg, 1, out),
          'revolveVec',
        )
        return newSolid(dv.getUint32(out, true))
      } finally {
        k.free(base)
        k.free(axis)
        k.free(arr)
        k.free(out)
      }
    },
    sweep(profile: BrepHandle, spine: BrepHandle): BrepHandle {
      // C 组合（B 简化）：profile 外环曲线 + spine 折线采样 → 线性扫掠近似。
      // L1 sweep 是"profile face 沿 spine wire"；smlib SmApiCreateCurveSweep 需要
      // BSplineCurve 路径 + 高级选项，超出 L1 语义——本轮按能力缺口显式失败。
      void profile; void spine
      return unsupported('sweep')
    },
    loft(sections: BrepHandle[], ruled: boolean, endPoint?: BrepVec3): BrepHandle {
      // B：每 wire 查曲线数组 → SmApiCreateSkinPrimitiveEx（ruled → degree 1）。
      if (sections.length < 2) throw new Error('[smlib-kernel] loft: need >= 2 sections')
      void endPoint // smlib 无收口退化截面语义（方案 §4.3 记录探针项）
      const allCurves: number[] = []
      const counts: number[] = []
      for (const s of sections) {
        const curves = wireHandles.get(s as unknown as number)
        if (!curves || curves.length === 0) {
          throw new Error('[smlib-kernel] loft: section is not a makeWire handle')
        }
        counts.push(curves.length)
        allCurves.push(...curves)
      }
      const countsBuf = k.malloc(4 * counts.length)
      const arr = k.malloc(4 * allCurves.length)
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        counts.forEach((c, i) => dv.setUint32(countsBuf + i * 4, c, true))
        allCurves.forEach((c, i) => dv.setUint32(arr + i * 4, c, true))
        dv.setUint32(out, 0, true)
        expectOk(
          k.find('SmApiCreateSkinPrimitiveEx')(countsBuf, counts.length, arr, allCurves.length, ruled ? 1 : 3, 1, out),
          'loft',
        )
        return newSolid(dv.getUint32(out, true))
      } finally {
        k.free(countsBuf)
        k.free(arr)
        k.free(out)
      }
    },
    sew(shapes: BrepHandle[], tolerance?: number): BrepHandle {
      // C 组合：多 brep/face 缝合无直接 API（SmApiStitch 是单 brep 原地）。
      // 用布尔并集近似仅在 face 同体场景成立——语义不完整，按缺口显式失败。
      void shapes; void tolerance
      return unsupported('sew')
    },
    sewAndSolidify(faces: BrepHandle[], tolerance?: number): BrepHandle {
      void faces; void tolerance
      return unsupported('sewAndSolidify')
    },
    shell(solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, tolerance: number): BrepHandle {
      // A：SmApiShellBrepFullEx（面集合 + 距离 + 扩展/自交关）。facesToRemove 是
      // solid 的面句柄，直接传（桥对 const SmBrep* 只读、面句柄即其子形状）。
      void tolerance
      const arr = k.malloc(4 * facesToRemove.length)
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        facesToRemove.forEach((f, i) => dv.setUint32(arr + i * 4, f as unknown as number, true))
        dv.setUint32(out, 0, true)
        expectOk(
          k.find('SmApiShellBrepFullEx')(solid, thickness, 0, 1, 1, arr, facesToRemove.length, out),
          'shell',
        )
        return newSolid(dv.getUint32(out, true))
      } finally {
        k.free(arr)
        k.free(out)
      }
    },
    hullFromPoints(points: BrepVec3[], tolerance: number): BrepHandle {
      void points; void tolerance
      return unsupported('hullFromPoints')
    },
    bsplineSurface(points: BrepVec3[], rows: number, cols: number): BrepHandle {
      // A：SmApiCreateSurfaceFromOrderedPointsEx（过点插值；≥4×4 由内核校验）。
      const p = ptsToMemory(k, points)
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        dv.setUint32(out, 0, true)
        expectOk(
          k.find('SmApiCreateSurfaceFromOrderedPointsEx')(p.ptr, points.length, rows, cols, out),
          'bsplineSurface',
        )
        return dv.getUint32(out, true) as BrepHandle
      } finally {
        k.free(p.ptr)
        k.free(out)
      }
    },
    makeSolid(shell: BrepHandle): BrepHandle {
      // B：smlib 的 shell 句柄即 solid（P1 getSubShapes('shell') 占位），
      // StitchIntoSolid 复核流形后返回原句柄。
      const out = k.malloc(8)
      try {
        const dv = memOf(k)
        dv.setUint32(out, 0, true)
        expectOk(k.find('SmApiStitchIntoSolidEx')(shell, out), 'makeSolid')
        return shell
      } finally {
        k.free(out)
      }
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
      // A：SmApiMergeBrepsEx（UNION=1；入参副本化，原句柄不动）。
      if (shapes.length < 2) throw new Error('[smlib-kernel] fuseAll: need >= 2 shapes')
      const arr = k.malloc(4 * shapes.length)
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        shapes.forEach((s, i) => dv.setUint32(arr + i * 4, s as unknown as number, true))
        dv.setUint32(out, 0, true)
        expectOk(k.find('SmApiMergeBrepsEx')(arr, shapes.length, 1, out), 'fuseAll')
        return newSolid(dv.getUint32(out, true))
      } finally {
        k.free(arr)
        k.free(out)
      }
    },
    sectionByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle[] {
      // A：SmApiIntersectBrepWithPlaneEx → 截面曲线句柄数组。
      const pt = k.malloc(24)
      const nrm = k.malloc(24)
      const count = k.malloc(4)
      const arrOut = k.malloc(4)
      try {
        const dv = memOf(k)
        dv.setFloat64(pt, point.x, true)
        dv.setFloat64(pt + 8, point.y, true)
        dv.setFloat64(pt + 16, point.z, true)
        dv.setFloat64(nrm, normal.x, true)
        dv.setFloat64(nrm + 8, normal.y, true)
        dv.setFloat64(nrm + 16, normal.z, true)
        dv.setUint32(count, 0, true)
        dv.setUint32(arrOut, 0, true)
        expectOk(
          k.find('SmApiIntersectBrepWithPlaneEx')(shape, pt, nrm, count, arrOut),
          'sectionByPlane',
        )
        const n = dv.getUint32(count, true)
        const arr = dv.getUint32(arrOut, true)
        if (!arr) throw new Error('[smlib-kernel] sectionByPlane: bridge returned null array')
        try {
          const ptrs = new Uint32Array(k.memory.buffer, arr, n)
          return Array.from(ptrs, (p) => p as BrepHandle)
        } finally {
          k.free(arr)
        }
      } finally {
        k.free(pt)
        k.free(nrm)
        k.free(count)
        k.free(arrOut)
      }
    },
    splitByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): { positive: BrepHandle; negative: BrepHandle } {
      // B：副本化 ×2 + SmApiCutEx（正向/反向法向各切一侧，保留侧由内核钉死，
      // P2 测试验证）。
      const positive = primitives.copy(shape)
      const negative = primitives.copy(shape)
      const pt = k.malloc(24)
      const nrm = k.malloc(24)
      try {
        const dv = memOf(k)
        dv.setFloat64(pt, point.x, true)
        dv.setFloat64(pt + 8, point.y, true)
        dv.setFloat64(pt + 16, point.z, true)
        dv.setFloat64(nrm, normal.x, true)
        dv.setFloat64(nrm + 8, normal.y, true)
        dv.setFloat64(nrm + 16, normal.z, true)
        expectOk(k.find('SmApiCutEx')(positive, pt, nrm), 'splitByPlane:positive')
        dv.setFloat64(nrm, -normal.x, true)
        dv.setFloat64(nrm + 8, -normal.y, true)
        dv.setFloat64(nrm + 16, -normal.z, true)
        expectOk(k.find('SmApiCutEx')(negative, pt, nrm), 'splitByPlane:negative')
        return { positive, negative }
      } finally {
        k.free(pt)
        k.free(nrm)
      }
    },

    // ── 倒角与圆角 ──
    chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle {
      // B（语义差异大）：SmApiChamferFillet 是**全体边自动倒角**（按斜切面宽），
      // 非逐边。副本化入参后全局倒角（§4.3 记录；edges 集合忽略）。
      void edges
      const copy = primitives.copy(solid)
      expectOk(k.find('SmApiChamferFilletEx')(copy, distance), 'chamfer')
      return copy
    },
    chamferDistAngle(solid: BrepHandle, edges: BrepHandle[], distance: number, angleDeg: number): BrepHandle {
      // smlib 无距离-角度双参倒角 → 按能力缺口显式失败。
      void solid; void edges; void distance; void angleDeg
      return unsupported('chamferDistAngle')
    },
    fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle {
      // B：副本化 + 按原边索引映射到副本边 + SmApiFilletEdgesEx（逐边，xsect=circular）。
      if (edges.length === 0) return primitives.copy(solid)
      const copy = primitives.copy(solid)
      const origEdges = primitives.getSubShapes(solid, 'edge').map((h) => h as unknown as number)
      const idxMap = new Map<number, number>()
      origEdges.forEach((e, i) => idxMap.set(e, i))
      const copyEdges = primitives.getSubShapes(copy, 'edge').map((h) => h as unknown as number)
      const sel = edges
        .map((e) => idxMap.get(e as unknown as number))
        .filter((i): i is number => i !== undefined)
        .map((i) => copyEdges[i])
      if (sel.length === 0) throw new Error('[smlib-kernel] fillet: no matching edges on copy')
      const arr = k.malloc(4 * sel.length)
      try {
        const dv = memOf(k)
        sel.forEach((e, i) => dv.setUint32(arr + i * 4, e, true))
        expectOk(k.find('SmApiFilletEdgesEx')(copy, arr, sel.length, radius), 'fillet')
        return copy
      } finally {
        k.free(arr)
      }
    },
    filletVariable(solid: BrepHandle, edge: BrepHandle, startRadius: number, endRadius: number): BrepHandle {
      // A 项（SmApiVariableRadiusFillet）需要 SmTArray 入参桥，P2 本轮未补 → 显式失败。
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
      // 注意：emscripten 导出 SmApiRotate(brep, originPtr, dirPtr, angleDeg)
      // 的 angleDeg 是 f64 **数值**（非指针）——传指针会被当度数解释。
      const p = k.malloc(56)
      try {
        const dv = memOf(k)
        dv.setFloat64(p, axis.point.x, true)
        dv.setFloat64(p + 8, axis.point.y, true)
        dv.setFloat64(p + 16, axis.point.z, true)
        dv.setFloat64(p + 24, axis.direction.x, true)
        dv.setFloat64(p + 32, axis.direction.y, true)
        dv.setFloat64(p + 40, axis.direction.z, true)
        expectOk(k.find('SmApiRotate')(shape, p, p + 24, (angleRad * 180) / Math.PI), 'rotate')
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
      // B：3×4 行主序 → SmApiTransformMatrixEx（SetFrom4x4，可编码反射/剪切）。
      return applyMatrix(k, shape, matrix, 'transform')
    },
    located(shape: BrepHandle, matrix: number[]): BrepHandle {
      return applyMatrix(k, shape, matrix, 'located')
    },
    locate(shape: BrepHandle, matrix: number[]): BrepHandle {
      return applyMatrix(k, shape, matrix, 'locate')
    },
    generalTransform(shape: BrepHandle, matrix: number[]): BrepHandle {
      return applyMatrix(k, shape, matrix, 'generalTransform')
    },
    mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle {
      // 反射矩阵（3×4）：R = I − 2nnᵀ，t = 2(n·p)n。
      const n = normVec(normal)
      const r = (i: number, j: number): number => (i === j ? 1 : 0) - 2 * [n.x, n.y, n.z][i] * [n.x, n.y, n.z][j]
      const t = (i: number): number => 2 * dot(n, point) * [n.x, n.y, n.z][i]
      const m = [
        r(0, 0), r(0, 1), r(0, 2), t(0),
        r(1, 0), r(1, 1), r(1, 2), t(1),
        r(2, 0), r(2, 1), r(2, 2), t(2),
      ]
      return applyMatrix(k, shape, m, 'mirror')
    },

    // ── 阵列 ──
    linearPattern(shape: BrepHandle, direction: BrepVec3, spacing: number, count: number): BrepHandle[] {
      // C 组合：copy + translate 循环（含原位置）。
      const out: BrepHandle[] = [shape]
      for (let i = 1; i < count; i++) {
        out.push(primitives.translate(primitives.copy(shape), direction.x * spacing * i, direction.y * spacing * i, direction.z * spacing * i))
      }
      return out
    },
    circularPattern(shape: BrepHandle, center: BrepVec3, axis: BrepVec3, angleStep: number, count: number): BrepHandle[] {
      // C 组合：copy + rotate 循环（角度制换算，绕 center/axis）。
      const out: BrepHandle[] = [shape]
      for (let i = 1; i < count; i++) {
        const c = primitives.copy(shape)
        primitives.rotate(c, { point: center, direction: axis }, (angleStep * i * Math.PI) / 180)
        out.push(c)
      }
      return out
    },
    gridPattern(
      shape: BrepHandle, directionX: BrepVec3, directionY: BrepVec3, spacingX: number, spacingY: number, countX: number, countY: number,
    ): BrepHandle {
      // C：L1 要求返回 compound 单句柄；smlib 无 compound → 显式失败（§4.3）。
      void shape; void directionX; void directionY; void spacingX; void spacingY; void countX; void countY
      return unsupported('gridPattern')
    },

    // ── 曲线构造 ──
    makeLineEdge(start: BrepVec3, end: BrepVec3): BrepHandle {
      // A：SmApiCreateLineSegment（输出 SmLine* 曲线句柄，可当 L1 边用——
      // 查询桥已支持裸曲线直通）。
      const p = ptsToMemory(k, [start, end])
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        dv.setUint32(out, 0, true)
        expectOk(k.find('SmApiCreateLineSegment')(p.ptr, p.ptr + 24, out), 'makeLineEdge')
        return dv.getUint32(out, true) as BrepHandle
      } finally {
        k.free(p.ptr)
        k.free(out)
      }
    },
    makeArcEdge(start: BrepVec3, mid: BrepVec3, end: BrepVec3): BrepHandle {
      // B：三点 → 外接圆圆心 + 起止角 → SmApiCreateArc（XY 平面）→ 变换到三点平面。
      return threePointArc(k, start, mid, end)
    },
    makeBezierEdge(controlPoints: BrepVec3[]): BrepHandle {
      // B：Bezier = 满重 B-spline（degree=n−1，唯一 knots=[0,1] 各满重，
      // weights 省略=全有理 1）。
      if (controlPoints.length < 2) throw new Error('[smlib-kernel] makeBezierEdge: need >= 2 control points')
      const degree = controlPoints.length - 1
      return createCanonicalCurve(k, controlPoints, [0, 1], [degree + 1, degree + 1], undefined, degree)
    },
    makeBSplineEdge(
      poles: number[], weights: number[], knots: number[], multiplicities: number[], degree: number, periodic?: boolean,
    ): BrepHandle {
      // A：与 SmApiCreateCanonicalCurve **完全同构**（poles 展平 xyz、knots/mults 平行）。
      // 全 1 weights = 非有理曲线 = 与省略 weights 等价；归一化为 undefined 消除
      // 两条内存路径（探针：全 1 显式传参在 vitest 下偶发 1001，归一化后稳定）。
      void periodic // smlib 周期由 eForm/内核定；L1 periodic 语义按文档记录（P2 探针）
      const pts: BrepVec3[] = []
      for (let i = 0; i < poles.length; i += 3) pts.push({ x: poles[i], y: poles[i + 1], z: poles[i + 2] })
      const w =
        weights && weights.length > 0 && weights.some((x) => x !== 1) ? weights : undefined
      return createCanonicalCurve(k, pts, knots, multiplicities, w, degree)
    },
    makeCircleEdge(center: BrepVec3, normal: BrepVec3, radius: number): BrepHandle {
      // B：SmApiCreateCircle（XY 平面、圆心原点）→ 变换到 center+normal 平面。
      const out = k.malloc(4)
      const p = k.malloc(24)
      try {
        const dv = memOf(k)
        dv.setFloat64(p, 0, true)
        dv.setFloat64(p + 8, 0, true)
        dv.setFloat64(p + 16, 0, true)
        dv.setUint32(out, 0, true)
        expectOk(k.find('SmApiCreateCircle')(p, radius, out), 'makeCircleEdge')
        const c = dv.getUint32(out, true)
        applyMatrix(k, c as BrepHandle, circlePlacementMatrix(center, normal), 'makeCircleEdge:place')
        return c as BrepHandle
      } finally {
        k.free(out)
        k.free(p)
      }
    },
    makeCircleArc(center: BrepVec3, normal: BrepVec3, radius: number, startAngle: number, endAngle: number): BrepHandle {
      // B：SmApiCreateArc（XY 平面、角度度制直通）→ 变换到 center+normal 平面。
      const out = k.malloc(4)
      const p = k.malloc(24)
      try {
        const dv = memOf(k)
        dv.setFloat64(p, 0, true)
        dv.setFloat64(p + 8, 0, true)
        dv.setFloat64(p + 16, 0, true)
        dv.setUint32(out, 0, true)
        expectOk(
          k.find('SmApiCreateArc')(p, radius, startAngle, endAngle, out),
          'makeCircleArc',
        )
        const c = dv.getUint32(out, true)
        applyMatrix(k, c as BrepHandle, circlePlacementMatrix(center, normal), 'makeCircleArc:place')
        return c as BrepHandle
      } finally {
        k.free(out)
        k.free(p)
      }
    },
    makeHelixWire(
      origin: BrepVec3, axis: BrepVec3, pitch: number, height: number, radius: number, leftHanded?: boolean,
    ): BrepHandle {
      // B：SmApiCreateHelix（+Z 局部系，右手/左手 + 容差）→ 变换到 origin+axis 平面。
      const out = k.malloc(4)
      const p = k.malloc(24)
      try {
        const dv = memOf(k)
        dv.setFloat64(p, 0, true)
        dv.setFloat64(p + 8, 0, true)
        dv.setFloat64(p + 16, 0, true)
        dv.setUint32(out, 0, true)
        const turns = height / pitch
        expectOk(
          k.find('SmApiCreateHelix')(p, height, radius, radius, turns, leftHanded ? 0 : 1, 1e-3, out),
          'makeHelixWire',
        )
        const c = dv.getUint32(out, true)
        applyMatrix(k, c as BrepHandle, circlePlacementMatrix(origin, axis), 'makeHelixWire:place')
        return c as BrepHandle
      } finally {
        k.free(out)
        k.free(p)
      }
    },
    approximatePoints(points: BrepVec3[], tolerance?: number): BrepHandle {
      // A：SmApiCreateCurveApproxPointsEx。
      void tolerance // 内核按拟合容差自定
      const p = ptsToMemory(k, points)
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        dv.setUint32(out, 0, true)
        expectOk(k.find('SmApiCreateCurveApproxPointsEx')(p.ptr, points.length, out), 'approximatePoints')
        return dv.getUint32(out, true) as BrepHandle
      } finally {
        k.free(p.ptr)
        k.free(out)
      }
    },
    interpolatePointsWithTangents(points: BrepVec3[], startTangent: BrepVec3, endTangent: BrepVec3): BrepHandle {
      // B（降级，决策点 3 记录）：SM_API 无带切向约束插值 → 降级 interpolatePoints
      // （丢两端切向，端点斜率与 occt 不同——有记录的近似）。
      void startTangent; void endTangent
      return primitives.interpolatePoints(points, 3)
    },
    curveSplit(edge: BrepHandle, param: number): [BrepHandle, BrepHandle] {
      void edge; void param
      return unsupported('curveSplit')
    },

    // ── 拓扑构造 ──
    makeWire(edges: BrepHandle[]): BrepHandle {
      // B：边/曲线 → 曲线句柄数组 → 合成 wire 句柄（smlib 无独立 wire 类型）。
      if (edges.length === 0) throw new Error('[smlib-kernel] makeWire: need >= 1 edge')
      const curves = edges.map((e) => edgeToCurve(k, e as unknown as number))
      return newWire(curves)
    },
    makeFace(wire: BrepHandle): BrepHandle {
      // A（wire 组合）：wire 曲线数组 → SmApiCreatePlanarFacesEx。
      const curves = wireHandles.get(wire as unknown as number)
      if (!curves || curves.length === 0) throw new Error('[smlib-kernel] makeFace: not a makeWire handle')
      return createPlanarFaces(k, curves)
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
      // B 组合：3 条线段 → CreatePlanarFacesEx。
      const curves = [
        primitives.makeLineEdge(a, b),
        primitives.makeLineEdge(b, c),
        primitives.makeLineEdge(c, a),
      ].map((h) => h as unknown as number)
      return createPlanarFaces(k, curves)
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
        if (type === 'wire') {
          // wire：合成句柄 → 登记的曲线句柄数组（裸曲线当边用）。
          const curves = wireHandles.get(shape as number)
          if (curves) return curves.map((c) => c as BrepHandle)
          return unsupported(`getSubShapes(${type})`)
        }
        if (type === 'vertex') {
          // 顶点枚举（适配器自建，用户确认）：遍历边端点，按坐标去重，分配
          // 合成句柄（VERTEX_TAG 高位，传 vertexPosition 查表）。
          const edges = primitives.getSubShapes(shape, 'edge')
          const p = k.malloc(48)
          try {
            const out: BrepHandle[] = []
            const seen = new Map<string, BrepHandle>()
            for (const e of edges) {
              expectOk(k.find('SmApiEdgeVerticesEx')(e as unknown as number, p), 'getSubShapes(vertex)')
              for (let off = 0; off < 48; off += 24) {
                const x = dv.getFloat64(p + off, true)
                const y = dv.getFloat64(p + off + 8, true)
                const z = dv.getFloat64(p + off + 16, true)
                const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`
                if (!seen.has(key)) {
                  const h = VERTEX_TAG + nextVertexId++
                  vertexHandles.set(h, { x, y, z })
                  seen.set(key, h as BrepHandle)
                  out.push(h as BrepHandle)
                }
              }
            }
            return out
          } finally {
            k.free(p)
          }
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
      // solid 登记表 + wire/vertex 合成表判别；face/edge 是裸借用指针无法判别
      //（smib 无类型查询）→ 显式失败。
      const h = shape as unknown as number
      if (solidHandles.has(h)) return 'SOLID'
      if (wireHandles.has(h)) return 'WIRE'
      if (vertexHandles.has(h)) return 'VERTEX'
      return unsupported('shapeType(non-solid)')
    },
    shapeOrientation(shape: BrepHandle): string {
      void shape
      return unsupported('shapeOrientation')
    },
    edgeToFaceMap(shape: BrepHandle): unknown {
      // B 组合：遍历每面 boundary loops 建边 → 面集合索引（Map<edgePtr, facePtr[]>）。
      const faces = primitives.getSubShapes(shape, 'face')
      const map = new Map<number, number[]>()
      for (const f of faces) {
        for (const e of primitives.getSubShapes(f, 'edge')) {
          const key = e as unknown as number
          const arr = map.get(key) ?? []
          arr.push(f as unknown as number)
          map.set(key, arr)
        }
      }
      return map
    },
    adjacentFaces(shape: BrepHandle, face: BrepHandle): BrepHandle[] {
      // B 组合：face 的边 → 其他含同边的面。
      const faceEdges = new Set(primitives.getSubShapes(face, 'edge').map((e) => e as unknown as number))
      const out: BrepHandle[] = []
      for (const f of primitives.getSubShapes(shape, 'face')) {
        if (f === face) continue
        const es = new Set(primitives.getSubShapes(f, 'edge').map((e) => e as unknown as number))
        for (const e of faceEdges) {
          if (es.has(e)) {
            out.push(f)
            break
          }
        }
      }
      return out
    },
    sharedEdges(a: BrepHandle, b: BrepHandle): BrepHandle[] {
      // B 组合：两面的边界边交集。
      const as = new Set(primitives.getSubShapes(a, 'edge').map((e) => e as unknown as number))
      return primitives.getSubShapes(b, 'edge').filter((e) => as.has(e as unknown as number))
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
      // 顶点枚举的合成句柄 → 查表返回坐标（原生 SmVertex* 通道无枚举 API，
      // 适配器自建，用户确认口径）。
      const v = vertexHandles.get(vertex as unknown as number)
      if (!v) return unsupported('vertexPosition')
      return v
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
      // A：SmApiCreateCurveInterpPointsEx（内核三次过点；degree 参数按文档
      // brepkit 方言口径忽略——smlib 固定 cubic）。
      void degree
      if (points.length < 4) throw new Error('[smlib-kernel] interpolatePoints: need >= 4 points')
      const p = ptsToMemory(k, points)
      const out = k.malloc(4)
      try {
        const dv = memOf(k)
        dv.setUint32(out, 0, true)
        expectOk(k.find('SmApiCreateCurveInterpPointsEx')(p.ptr, points.length, 0, out), 'interpolatePoints')
        return dv.getUint32(out, true) as BrepHandle
      } finally {
        k.free(p.ptr)
        k.free(out)
      }
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
      // B 组合：全部边（按句柄去重）弧长之和。
      const edges = new Set(primitives.getSubShapes(shape, 'edge').map((e) => e as unknown as number))
      let total = 0
      for (const e of edges) total += primitives.curveLength(e as BrepHandle)
      return total
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
      // A：副本化 + SmApiHealBrepEx 原地修复；KNOWN_ISSUES 声明 heal 可能假成功
      // → 适配器修复后复核 manifold（不通过则按失败抛出）。
      void tolerance
      const copy = primitives.copy(shape)
      expectOk(k.find('SmApiHealBrepEx')(copy), 'healSolid')
      if (!primitives.isSolid(copy)) {
        throw new Error('[smlib-kernel] healSolid: result is not a manifold solid (heal false-success guard)')
      }
      return copy
    },
    fixShape(shape: BrepHandle): BrepHandle {
      // B：brepkit 同模式降级 healSolid（现有）。
      return primitives.healSolid(shape)
    },
    fixFaceOrientations(shape: BrepHandle): BrepHandle {
      // B：副本化 + SmApiUnifyNormalsEx（16 采样）原地统一法向。
      const copy = primitives.copy(shape)
      expectOk(k.find('SmApiUnifyNormalsEx')(copy, 16), 'fixFaceOrientations')
      return copy
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
