/**
 * smlib-kernel/smlibKernel — smlib（@faicad/smlib-wasm 独立包）→ faijs BrepEngineApi 薄适配器
 *
 * 架构（2026-10-29 迁移定稿）：
 * - 所有权全部上移 C++ Kernel（branded number id + arena）；本适配器不再持有
 *   HandleRegistry / solidHandles / faceHandles / edgeHandles 三套 Set，也不做裸桥
 *   `k.find('SmApi*')` 双拷贝布尔舞步。
 * - borrowed Face/Edge/Curve（owner≠0）只由内核随主人释放，适配器绝不 track；
 *   owned solid / curve / surface 返回处 track，per-statement 帧末逐个 tryRelease。
 * - `release(shape)` 保持 no-op（GC 型引用语义，brep-ops.ts 大量 `kernel.release(...)`
 *   依赖轮末清扫 `releaseAllExcept`）；`disposeHandle` 幂等真释放；`dispose()` =
 *   releaseAll + 清合成表 + 清三角化缓存。
 * - 纯 JS 几何 helper（向量、三点弧、放置矩阵、矩阵复合、反射、STEP 拼接、射线奇偶
 *   点包含）保留在本文件；内核调用全部走包壳类型化方法，不再手算内存布局。
 */
import { SmwKind, SmwMergeOp, SmlibError } from '@faicad/smlib-wasm'
import { initSmlibWasm, resetSmlibWasm } from './smlibWasm'
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

/** STL 导入的顶点焊接容差（mm）。 */
const STL_WELD_TOL_MM = 1e-6
/** STEP 导入的缝合/裁剪容差（mm）。 */
const STEP_IMPORT_TOL_MM = 1e-4

/** 适配器内部显式失败（能力缺失：op 级 engines 声明在装配前拦截，桩兜底防御）。 */
function unsupported(name: string): never {
  throw new Error(`[smlib-kernel] ${name}: not implemented in P1 (plan §6 P2/P3)`)
}

// ── 合成句柄 TAG（smlib 无独立 wire / vertex / compound 类型；高位虚拟值永不撞内核 id）──
const WIRE_TAG = 0x200000000
const VERTEX_TAG = 0x300000000
const COMPOUND_TAG = 0x400000000

/** 确定性子形状 hash：(ownerId, ordinal) 确定性映射；meshShape faceGroups 与
 *  subShapeHashes 必须同源（types.ts BREP_HASH_BOUND 是唯一真源）。 */
function ordinalHash(owner: number, index: number, upperBound: number): number {
  return (((owner >>> 0) * 1000003 + index) >>> 0) % upperBound
}

// ── 点包含判定（containsPoint）：三角化 + 固定非轴对齐射线奇偶 ──
interface TriMesh {
  positions: Float32Array
  indices: Uint32Array
}

const triCacheByMemory = new WeakMap<WebAssembly.Memory, Map<number, TriMesh>>()

function triCacheOf(memory: WebAssembly.Memory): Map<number, TriMesh> {
  let m = triCacheByMemory.get(memory)
  if (!m) {
    m = new Map()
    triCacheByMemory.set(memory, m)
  }
  return m
}

function rayCrossings(mesh: TriMesh, p: BrepVec3, d: BrepVec3): number {
  const pos = mesh.positions
  const idx = mesh.indices
  let cross = 0
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t]! * 3
    const i1 = idx[t + 1]! * 3
    const i2 = idx[t + 2]! * 3
    const e1x = pos[i1]! - pos[i0]!, e1y = pos[i1 + 1]! - pos[i0 + 1]!, e1z = pos[i1 + 2]! - pos[i0 + 2]!
    const e2x = pos[i2]! - pos[i0]!, e2y = pos[i2 + 1]! - pos[i0 + 1]!, e2z = pos[i2 + 2]! - pos[i0 + 2]!
    const hx = d.y * e2z - d.z * e2y
    const hy = d.z * e2x - d.x * e2z
    const hz = d.x * e2y - d.y * e2x
    const a = e1x * hx + e1y * hy + e1z * hz
    if (Math.abs(a) < 1e-12) continue
    const f = 1 / a
    const sx = p.x - pos[i0]!, sy = p.y - pos[i0 + 1]!, sz = p.z - pos[i0 + 2]!
    const u = f * (sx * hx + sy * hy + sz * hz)
    if (u < 0 || u > 1) continue
    const qx = sy * e1z - sz * e1y
    const qy = sz * e1x - sx * e1z
    const qz = sx * e1y - sy * e1x
    const v = f * (d.x * qx + d.y * qy + d.z * qz)
    if (v < 0 || u + v > 1) continue
    const tHit = f * (e2x * qx + e2y * qy + e2z * qz)
    if (tHit > 1e-9) cross++
  }
  return cross
}

const PARITY_RAY_DIR: BrepVec3 = (() => {
  const v = { x: 0.5731, y: 0.4189, z: 0.7043 }
  const l = Math.hypot(v.x, v.y, v.z)
  return { x: v.x / l, y: v.y / l, z: v.z / l }
})()

// ── 纯 JS 几何 helper ──

function normVec(v: BrepVec3): BrepVec3 {
  const len = Math.hypot(v.x, v.y, v.z)
  if (len === 0) throw new Error('[smlib-kernel] zero-length vector')
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function cross(a: BrepVec3, b: BrepVec3): BrepVec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function dot(a: BrepVec3, b: BrepVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function asArray(p: BrepVec3): [number, number, number] {
  return [p.x, p.y, p.z]
}

/**
 * XY 平面曲线（圆心原点）→ center+normal 局部平面的 3×4 行主序矩阵。
 *
 * **局部 X 轴 = 世界 +X 在该平面上的投影**（退化时取 +Y 投影）。这样局部角度就是
 * 世界角度，调用方不需要任何 `uAngle` 补偿；也对齐 OCCT `gp_Ax2(center, normal)`
 * 在 n=+Z 时的参考轴（+X）。v = n×u 保证 (u,v,n) 右手。
 */
function circlePlacementMatrix(center: BrepVec3, normal: BrepVec3): number[] {
  const n = normVec(normal)
  const ref = Math.abs(n.x) < 0.999 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const u = normVec(cross(cross(n, ref), n)) // ref 在平面上的投影，再归一
  const v = cross(n, u)
  return [u.x, v.x, n.x, center.x, u.y, v.y, n.y, center.y, u.z, v.z, n.z, center.z]
}

/**
 * 有向跨度（度）—— 从 `a0` 走到 `a1` 且**必须经过** `am` 的那个方向。
 *
 * 三点弧的方向由中点决定：先取 a0→a1 的 CCW 短跨度 `ccw`，再看 `am` 落在哪一侧；
 * `am` 不在 CCW 弧上时改用互补的负向跨度（`ccw − 360`）。返回 (-360, 360)。
 */
function arcSweepThrough(a0: number, a1: number, am: number): number {
  const ccw = (((a1 - a0) % 360) + 360) % 360
  if (ccw < 1e-9) return 360
  const db = ((((am - a0) % 360) + 540) % 360) - 180 // (-180, 180]
  if (db >= 0) return db <= ccw ? ccw : ccw - 360
  return db >= ccw - 360 ? ccw - 360 : ccw
}

/**
 * (起始角, 有向跨度) → 内核可接受的 (start, stop)。
 *
 * `SmBSplineCurve::CreateCircleSegment` 对两个角度都做 `RANGE_ER(-360, ·, 360)` 硬校验
 * （`SmBSplineCurve.cpp:1946`），所以越界值会被拒；同时跨度方向由 `stop − start` 的
 * 符号决定，**不能**把两端各自 `mod 360`（那会把 20° 短弧翻成 340° 长弧）。这里只做
 * 「整体平移 360」，跨度与方向一动不动。
 */
function arcAnglePair(startDeg: number, sweepDeg: number): [number, number] {
  let a = startDeg
  let b = startDeg + sweepDeg
  while (b > 360) {
    a -= 360
    b -= 360
  }
  while (b < -360) {
    a += 360
    b += 360
  }
  return [a, b]
}

/** 3×4 行主序矩阵复合：先 m2 后 m1。 */
function composeTransform(m1: number[], m2: number[]): number[] {
  const out = new Array<number>(12).fill(0)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 4 + j] =
        m1[i * 4 + 0]! * m2[0 * 4 + j]! +
        m1[i * 4 + 1]! * m2[1 * 4 + j]! +
        m1[i * 4 + 2]! * m2[2 * 4 + j]!
    }
    out[i * 4 + 3] =
      m1[i * 4 + 0]! * m2[0 * 4 + 3]! +
      m1[i * 4 + 1]! * m2[1 * 4 + 3]! +
      m1[i * 4 + 2]! * m2[2 * 4 + 3]! +
      m1[i * 4 + 3]!
  }
  return out
}

/**
 * 多实体 STEP 文本拼接（虚拟 compound 导出）：首段保留 HEADER+DATA;，后续段实体编号
 * 整体偏移；只触碰编号行，不做坐标/几何改写。
 */
function mergeStepEntities(parts: string[]): string {
  const headerOf = (s: string): string => {
    const m = s.match(/^([\s\S]*?DATA;)\s*\n?/)
    return m ? m[1]! : ''
  }
  const bodyOf = (s: string): string => {
    const m = s.match(/DATA;\s*\n?([\s\S]*?)\n?ENDSEC;/)
    return m ? m[1]! : ''
  }
  const maxIdOf = (body: string): number => {
    let max = 0
    for (const m of body.matchAll(/#(\d+)/g)) max = Math.max(max, parseInt(m[1]!, 10))
    return max
  }
  const header = headerOf(parts[0]!)
  const lines: string[] = []
  let offset = 0
  for (let i = 0; i < parts.length; i++) {
    const body = bodyOf(parts[i]!)
    if (i === 0) {
      lines.push(body)
      offset = maxIdOf(body)
    } else {
      lines.push(body.replace(/#(\d+)/g, (_m, n: string) => `#${parseInt(n, 10) + offset}`))
      offset += maxIdOf(body)
    }
  }
  return `${header}\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`
}

/**
 * smlib 原语集合（BrepEngineApi 对象字面量）。初始化共享内核单例
 * （initSmlibWasm 幂等）。
 */
export type SmlibPrimitives = BrepEngineApi

let primitivesSingleton: SmlibPrimitives | null = null

/** 创建（幂等）并返回 smlib 原语集合。
 * @returns the shared smlib primitives singleton.
 */
export async function createSmlibPrimitives(): Promise<SmlibPrimitives> {
  if (primitivesSingleton) return primitivesSingleton
  const k = await initSmlibWasm()

  // ── 适配器侧所有权簿记（只负责“何时调用包壳释放”，不持有几何）──
  const tracked = new Set<number>()
  const frames: number[][] = []

  const track = <T extends number>(id: T): T => {
    tracked.add(id)
    const frame = frames[frames.length - 1]
    if (frame) frame.push(id)
    return id
  }

  // 合成句柄表（内核不可见；高位值绝不传入包壳方法）。
  let nextWireId = 1
  let nextVertexId = 1
  let nextCompoundId = 1
  const wireHandles = new Map<number, number[]>()
  /**
   * face id → 边界环 wire（合成句柄，按 loop 顺序）。
   *
   * 为什么需要：smlib 没有 wire 实体，而 `sweep` / `loft` 的截面适配
   * （`api/internal/profile-wire.ts` 的 `getSubShapes(face, 'wire')`）要求「面 → 外环
   * wire」。**索引 0 = 外环**：SMLib 契约规定 `SmApiFaceGetBoundaryLoops` 的
   * `GetUpwardLoopuses` 首个 loop 即 OuterLoop（`usd-brep/source/SM_API/src/SmApiQueries.cpp:324`
   * + `SmBrep.h:436/936` 的 "1st Loop=OuterLoop"）。
   *
   * 缓存键是 arena face id（单调不复用，不会串到别的面）。缓存在轮末清扫时整体丢弃 ——
   * face 是 borrowed 子形状，随 owner solid 失效，缓存不能跨轮存活。
   */
  const faceWireCache = new Map<number, BrepHandle[]>()
  const vertexHandles = new Map<number, BrepVec3>()
  const compoundHandles = new Map<number, BrepHandle[]>()
  // 真实 borrowed Face/Edge 的确定性 hash 必须与其 owner solid 的枚举序号同源；
  // C++ 只返回子形状 slot id，父关系需在这里短生命周期记录。
  let shapeEpoch = 0
  const subShapeOrdinal = new Map<number, { epoch: number; owner: number; index: number }>()
  const recordSubShape = (owner: number, index: number, handle: unknown): void => {
    subShapeOrdinal.set(handle as number, { epoch: shapeEpoch, owner, index })
  }

  function newCompound(kids: BrepHandle[]): BrepHandle {
    const handle = COMPOUND_TAG + nextCompoundId++
    compoundHandles.set(handle, kids)
    return handle as BrepHandle
  }
  function compoundKidsOf(shape: BrepHandle): BrepHandle[] | undefined {
    return typeof shape === 'number' && shape >= COMPOUND_TAG ? compoundHandles.get(shape) : undefined
  }
  function newWire(curves: number[]): BrepHandle {
    const handle = WIRE_TAG + nextWireId++
    wireHandles.set(handle, curves)
    return handle as BrepHandle
  }
  const isSynthetic = (n: number): boolean => n >= WIRE_TAG

  /**
   * 逃生句柄的闭包：合成句柄（wire / compound）本身不是 arena 对象，它的成员才是。
   *
   * 语句帧末释放只看句柄本身时，产物 `cad.wire([...])` 的 wire 句柄逃逸了，但它的
   * curve 成员没有 → 帧末被 `tryRelease` 掉，产物变成指向已释放内核对象的空壳。
   * 实测症状：`cad.wire` 语句执行成功，随后拓扑构建在 `smw_curve_type` 上抛
   * `ErrBadId: bad edge id 1`（curve 已被释放）。compound 同理（成员是子实体）。
   */
  function expandEscapeClosure(escapePtrs: ReadonlySet<number>): ReadonlySet<number> {
    let keep: Set<number> | undefined
    const visit = (root: number): void => {
      const kids = (wireHandles.get(root) ?? compoundHandles.get(root)) as number[] | undefined
      if (!kids) return
      for (const kid of kids) {
        const c = kid as unknown as number
        if (escapePtrs.has(c)) continue
        keep ??= new Set(escapePtrs)
        if (keep.has(c)) continue
        keep.add(c)
        visit(c)
      }
    }
    for (const h of escapePtrs) visit(h)
    return keep ?? escapePtrs
  }

  /**
   * 先复制再变换 —— faijs 变换的语义基准是 OCCT 的 `BRepBuilderAPI_Transform`
   * （Copy=true：输入不变，返回新实体）。
   *
   * 这里曾经直接原地变换（`k.translate(shape)` 改 arena 对象），后果不是"省一次拷贝"
   * 而是**改掉调用方的零件**：`cad.translate(p0, …)` 之后 p0 的底层 brep 一起移动，
   * mesh 缓存把症状掩盖，直到对 p0 再做几何才炸（loft 两截面被移到同一平面）。
   * 实测对照（`profile` 面 → 外环曲线端点的 z）：
   * OCCT `p0 z=[0,0,0,0]` / smlib 修复前 `p0 z=[20,20,20,20]`。
   */
  function onCopy(shape: BrepHandle, apply: (h: BrepHandle) => void): BrepHandle {
    const cKids = compoundKidsOf(shape)
    if (cKids) {
      const kids = cKids.map((kid) => onCopy(kid, apply))
      return newCompound(kids)
    }
    const copy = track(k.brepCopy(shape as never)) as unknown as BrepHandle
    apply(copy)
    return copy
  }

  /** face → 边界环合成 wire（幂等缓存）。索引 0 = 外环，见 faceWireCache 注释。 */
  function faceWires(n: number): BrepHandle[] {
    const cached = faceWireCache.get(n)
    if (cached) {
      cached.forEach((w, index) => recordSubShape(n, index, w))
      return cached
    }
    const loops = k.faceLoops(n as never)
    const wires = loops.loops.map((loop) => {
      const curves = loop.edges.map((e) => k.edgeToCurve(e as never) as unknown as number)
      return newWire(curves)
    })
    faceWireCache.set(n, wires)
    wires.forEach((w, index) => recordSubShape(n, index, w))
    return wires
  }

  // 合成句柄判定 → kind：solid / face / edge / curve / surface。
  function faceOf(n: number): number {
    const kind = k.kindOf(n)
    if (kind === SmwKind.Face) return n
    if (kind === SmwKind.Solid) {
      const fs = k.faces(n as never)
      if (fs.length === 0) throw new Error('[smlib-kernel] faceOf: solid has no faces')
      return fs[0]! as number
    }
    throw new Error(`[smlib-kernel] faceOf: not a face/solid (kind=${kind})`)
  }

  function faceLoopsCurves(n: number): number[][] {
    const f = faceOf(n)
    const loops = k.faceLoops(f as never)
    return loops.loops.map((l) => l.edges.map((e) => k.edgeToCurve(e) as unknown as number))
  }
  function faceOuterCurves(n: number): number[] {
    return faceLoopsCurves(n)[0] ?? []
  }

  /**
   * 句柄 → 有序曲线 id：合成 wire 直接取成员，face/solid 取外环（孔环不参与扫掠，
   * 与 occt `sweepPipeShell` 的"面取外环"口径一致）。
   */
  function orderedCurvesOf(n: number): number[] {
    const w = wireHandles.get(n)
    if (w) return w
    return faceOuterCurves(n)
  }

  /**
   * 三点圆弧：外接圆圆心 + 局部 (u,v) 基上的起止角 → makeArc → 放置矩阵。
   *
   * 角度契约：`smw_make_arc` 在**局部 XY 平面**从 +X 起算，曲线随后被 `[u v w|center]`
   * 矩阵搬到世界。这里 a0/a1 本来就是用同一个 (u,v) 基算出来的（`ang()` 就是投影到
   * u、v 上取 atan2），所以**不需要任何世界方向补偿** —— 多加 `uAngle` 只会把弧整体
   * 转掉一个 `uAngle`。
   *
   * 曾经的 `norm(a0 + 2*uAngle ∓ 0.05)` 有两个叠加缺陷（2026-10-31 定位）：
   *   ① 圆角矩形四条角弧整体转了 180°（uAngle=±90 时 2*uAngle=180），首尾不相连 →
   *      `SmApiCreatePlanarFaces failed`，worker-sim「全图元截面」段卡死；
   *   ② `±0.05°` 的"补角"让每个端点偏移 r·sin(0.05°)（r=2 时 0.0017mm），闭环永远
   *      差一点点 —— 即便角度修对，这个缝也可能让构面失败。
   */
  function threePointArc(start: BrepVec3, mid: BrepVec3, end: BrepVec3): BrepHandle {
    const a = start
    const b = mid
    const c = end
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
    const n = cross(ab, ac)
    const nLen = Math.hypot(n.x, n.y, n.z)
    if (nLen < 1e-12) throw new Error('[smlib-kernel] threePointArc: collinear points')
    const ab2 = dot(ab, ab)
    const ac2 = dot(ac, ac)
    const m11 = ab2
    const m12 = dot(ab, ac)
    const m22 = ac2
    const det = m11 * m22 - m12 * m12
    if (Math.abs(det) < 1e-18) throw new Error('[smlib-kernel] threePointArc: degenerate (zero plane area)')
    const alpha = (ab2 / 2 * m22 - ac2 / 2 * m12) / det
    const beta = (ac2 / 2 * m11 - ab2 / 2 * m12) / det
    const center = { x: a.x + alpha * ab.x + beta * ac.x, y: a.y + alpha * ab.y + beta * ac.y, z: a.z + alpha * ab.z + beta * ac.z }
    const r = Math.hypot(center.x - a.x, center.y - a.y, center.z - a.z)
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
    const am = ang(b)
    const a1 = ang(c)
    const [startDeg, stopDeg] = arcAnglePair(a0, arcSweepThrough(a0, a1, am))
    const curve = track(k.makeArc([0, 0, 0], r, startDeg, stopDeg))
    const m = [u.x, v.x, w.x, center.x, u.y, v.y, w.y, center.y, u.z, v.z, w.z, center.z]
    k.transformMatrix(curve as never, m)
    return curve as unknown as BrepHandle
  }

  const primitives: SmlibPrimitives = {
    // ── 生命周期 ──
    release(_shape: BrepHandle): void {
      // GC 型引用语义：release 不删内核对象；真释放由 disposeHandle / releaseAllExcept /
      // scope pop 负责（buildTopology transient 若在此被删会误删 solidCache 实体）。
    },
    disposeHandle(shape: BrepHandle): void {
      const n = shape as unknown as number
      if (isSynthetic(n)) return
      triCacheOf(k.memory).delete(n)
      if (k.tryRelease(n as never)) tracked.delete(n)
    },
    releaseAllExcept(keep: ReadonlySet<number>): void {
      const effectiveKeep = new Set(keep)
      // compound 子零件闭包保活。
      let changed = true
      while (changed) {
        changed = false
        for (const [c, kids] of compoundHandles) {
          if (effectiveKeep.has(c)) {
            for (const kid of kids) {
              if (!effectiveKeep.has(kid as unknown as number)) {
                effectiveKeep.add(kid as unknown as number)
                changed = true
              }
            }
          }
        }
      }
      k.releaseExcept([...effectiveKeep])
      shapeEpoch++
      subShapeOrdinal.clear()
      // face→wire 合成表随 owner face 失效：face 是 borrowed 子形状，轮末必然不在 keep 里，
      // 缓存与它产出的合成 wire 一并丢弃（`cad.wire` 的曲线不走这张表，不受影响）。
      for (const wires of faceWireCache.values()) {
        for (const w of wires) wireHandles.delete(w as unknown as number)
      }
      faceWireCache.clear()
      for (const id of tracked) {
        if (!effectiveKeep.has(id)) tracked.delete(id)
      }
      triCacheOf(k.memory).clear()
    },
    dispose(_shape?: BrepHandle): void {
      k.releaseAll()
      wireHandles.clear()
      faceWireCache.clear()
      vertexHandles.clear()
      compoundHandles.clear()
      subShapeOrdinal.clear()
      triCacheOf(k.memory).clear()
      tracked.clear()
      frames.length = 0
    },

    __pushStatementScope(_statementId: string): void {
      frames.push([])
    },
    __popStatementScope(escapePtrs: ReadonlySet<number>): void {
      const frame = frames.pop()
      if (!frame) return
      const keep = expandEscapeClosure(escapePtrs)
      for (const id of frame) {
        if (keep.has(id)) continue
        k.tryRelease(id as never)
        tracked.delete(id)
      }
    },
    __drainStatementScope(escapePtrs: ReadonlySet<number>): void {
      const keep = expandEscapeClosure(escapePtrs)
      while (frames.length) {
        const frame = frames.pop()!
        for (const id of frame) {
          if (keep.has(id)) continue
          k.tryRelease(id as never)
          tracked.delete(id)
        }
      }
    },

    // ── 实体图元 ──
    makeBox(dx: number, dy: number, dz: number): BrepHandle {
      return track(k.makeBox(0, 0, 0, dx, dy, dz)) as unknown as BrepHandle
    },
    makeBoxFromCorners(corner1: BrepVec3, corner2: BrepVec3): BrepHandle {
      const b = primitives.makeBox(corner2.x - corner1.x, corner2.y - corner1.y, corner2.z - corner1.z)
      return primitives.translate(b, corner1.x, corner1.y, corner1.z)
    },
    makeCylinder(radius: number, height: number): BrepHandle {
      return track(k.makeCylinder(0, 0, 0, radius, height)) as unknown as BrepHandle
    },
    makeSphere(radius: number): BrepHandle {
      return track(k.makeSphere(0, 0, 0, radius)) as unknown as BrepHandle
    },
    makeCone(r1: number, r2: number, height: number): BrepHandle {
      return track(k.makeCone(0, 0, 0, r1, r2, height)) as unknown as BrepHandle
    },
    makeRectangle(width: number, height: number): BrepHandle {
      const pts: BrepVec3[] = [
        { x: 0, y: 0, z: 0 },
        { x: width, y: 0, z: 0 },
        { x: width, y: height, z: 0 },
        { x: 0, y: height, z: 0 },
      ]
      const curves: number[] = []
      for (let i = 0; i < 4; i++) {
        curves.push(track(k.makeLineSegment(asArray(pts[i]!), asArray(pts[(i + 1) % 4]!))) as unknown as number)
      }
      // 成功后 owned 输入曲线被平面面消费（tombstone）；tracked 残留死槽在 pop/清扫时
      // tryRelease 幂等返回 false，无副作用。
      return track(k.planarFaces(curves as never)) as unknown as BrepHandle
    },
    makeEllipsoid(_rx: number, _ry: number, _rz: number): BrepHandle {
      return unsupported('makeEllipsoid')
    },
    makeTorus(majorRadius: number, minorRadius: number): BrepHandle {
      return track(k.makeTorus(0, 0, 0, majorRadius, minorRadius)) as unknown as BrepHandle
    },
    makeVertex(_x: number, _y: number, _z: number): BrepHandle {
      return unsupported('makeVertex')
    },

    // ── 造型运算 ──
    extrude(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle {
      const n = shape as unknown as number
      const loops = faceLoopsCurves(n)
      const curves = loops[0] ?? []
      if (curves.length === 0) throw new Error('[smlib-kernel] extrude: no outer-loop curves')
      const holes = loops.slice(1).filter((l) => l.length > 0)
      const dist = Math.hypot(dx, dy, dz)
      if (dist === 0) throw new Error('[smlib-kernel] extrude: zero extrusion vector')
      const inv = 1 / dist
      const dir: [number, number, number] = [dx * inv, dy * inv, dz * inv]
      let solid = track(k.linearSweep(curves as never, dir, dist, true)) as unknown as BrepHandle
      for (const hole of holes) {
        const holeSolid = track(k.linearSweep(hole as never, dir, dist, true))
        solid = track(k.cut(solid as never, holeSolid as never)) as unknown as BrepHandle
      }
      return solid
    },
    revolveVec(shape: BrepHandle, center: BrepVec3, direction: BrepVec3, angleDeg: number): BrepHandle {
      const n = shape as unknown as number
      const curves = faceOuterCurves(n)
      if (curves.length === 0) throw new Error('[smlib-kernel] revolveVec: no outer-loop curves')
      return track(
        k.rotationalSweep(curves as never, asArray(center), asArray(direction), angleDeg, true),
      ) as unknown as BrepHandle
    },
    sweep(profile: BrepHandle, spine: BrepHandle): BrepHandle {
      const profileCurves = orderedCurvesOf(profile as unknown as number)
      if (profileCurves.length === 0) throw new Error('[smlib-kernel] sweep: profile has no boundary curves')
      const pathCurves = orderedCurvesOf(spine as unknown as number)
      if (pathCurves.length === 0) throw new Error('[smlib-kernel] sweep: spine has no curves')
      // `moveProfile=true`（截面 bbox 中心对齐路径起点）：SMLib 的
      // SmApiCreateSweepAlongPlanarPath **总是**把截面搬到路径起点，只让调用方选参考点，
      // 而 faijs 的常规用法（草图/轮廓画在原点平面、脊柱从原点出发）与 bbox 中心口径一致。
      // `capEnds=3`：两端封盖 → 实体（开放路径不封盖会得到片体）。
      return track(
        k.sweepAlongPlanarPath(profileCurves as never, pathCurves as never, true, 3),
      ) as unknown as BrepHandle
    },
    loft(sections: BrepHandle[], ruled: boolean, _endPoint?: BrepVec3): BrepHandle {
      if (sections.length < 2) throw new Error('[smlib-kernel] loft: need >= 2 sections')
      const allCurves: number[] = []
      const counts: number[] = []
      for (const s of sections) {
        const curves = wireHandles.get(s as unknown as number)
        if (!curves || curves.length === 0) throw new Error('[smlib-kernel] loft: section is not a makeWire handle')
        counts.push(curves.length)
        allCurves.push(...curves)
      }
      // 蒙皮次数不能超过"截面数 − 1"：n 个截面最多 n−1 次插值。faijs 的 loft 默认
      // ruled=false（要求 smooth），但两个截面时三次插值无解，内核直接
      // `SmApiCreateSkinPrimitive failed`。这里按截面数收敛次数 —— 不是精度让步，
      // 是插值自由度的硬约束（OCCT 的 ThruSections 对两截面同样是线性）。
      const degree = ruled ? 1 : Math.min(3, sections.length - 1)
      return track(k.loft(counts, allCurves as never, degree, true)) as unknown as BrepHandle
    },
    sew(_shapes: BrepHandle[], _tolerance?: number): BrepHandle {
      return unsupported('sew')
    },
    sewAndSolidify(_faces: BrepHandle[], _tolerance?: number): BrepHandle {
      return unsupported('sewAndSolidify')
    },
    shell(solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, _tolerance: number): BrepHandle {
      const n = solid as unknown as number
      const openings = facesToRemove.map((f) => f as unknown as never)
      // 包壳内部已取负厚度（向内薄壁）；适配器只传正 thickness。
      const result = track(k.shell(n as never, thickness, openings))
      try {
        k.unifyNormals(result as never, 16)
      } catch {
        // 统一法向失败不回滚、不抛错：几何本身有效，仅内壁朝向可能异常。
      }
      return result as unknown as BrepHandle
    },
    hullFromPoints(_points: BrepVec3[], _tolerance: number): BrepHandle {
      return unsupported('hullFromPoints')
    },
    bsplineSurface(points: BrepVec3[], rows: number, cols: number): BrepHandle {
      const result = track(k.surfaceFromPoints(points.map(asArray), rows, cols))
      return result as unknown as BrepHandle
    },
    makeSolid(shell: BrepHandle): BrepHandle {
      // StitchResult 字段忽略；旧语义：返回 shell 原句柄。
      k.stitchSolid(shell as never)
      return shell
    },
    thicken(_shape: BrepHandle, _thickness: number, _tolerance?: number): BrepHandle {
      return unsupported('thicken')
    },

    // ── 布尔与分割（包壳 facade 深拷贝；输入句柄保持存活）──
    fuse(a: BrepHandle, b: BrepHandle): BrepHandle {
      return track(k.fuse(a as never, b as never)) as unknown as BrepHandle
    },
    cut(a: BrepHandle, b: BrepHandle): BrepHandle {
      return track(k.cut(a as never, b as never)) as unknown as BrepHandle
    },
    common(a: BrepHandle, b: BrepHandle): BrepHandle {
      return track(k.common(a as never, b as never)) as unknown as BrepHandle
    },
    intersect(a: BrepHandle, b: BrepHandle): BrepHandle {
      return track(k.common(a as never, b as never)) as unknown as BrepHandle
    },
    fuseAll(shapes: BrepHandle[]): BrepHandle {
      if (shapes.length < 2) throw new Error('[smlib-kernel] fuseAll: need >= 2 shapes')
      return track(k.mergeBreps(shapes.map((s) => s as never), SmwMergeOp.Union)) as unknown as BrepHandle
    },
    sectionByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle[] {
      const curves = k.sectionPlane(shape as never, asArray(point), asArray(normal))
      return curves.map((c) => track(c)) as unknown as BrepHandle[]
    },
    splitByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): { positive: BrepHandle; negative: BrepHandle } {
      const n = normal
      // 契约与 occt/brepkit 对齐：**必须真的把实体切成两块**。只擦过（相切于某个面）
      // 或整体在一侧时，有一半是空的，这不是"分割"。occt 在这种输入下抛
      // `splitByPlane: expected 2 solids, got 1`；smlib 若不先拦住，内核会拿一个与
      // 实体某面**共面**的半空间盒去做布尔减，产出带瑕疵的 BREP，随后三角化报
      // `ConvertToPolyBrep failed`（端侧 test:ops 两条 splitByPlane 的真身：居中
      // box 在 z=15 的顶面上切）。先算 bbox 八角的带符号距离，只有真正跨面才进内核。
      const bb = primitives.getBoundingBox(shape)
      const diag = Math.hypot(bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin)
      // 容差取模型对角线的 5e-6：SMLib 的 loose bbox 自带 ~2e-5 绝对松弛（实测
      // 10×20×30 的 box 报 z=[-15.00002, 15.00002]），用 1e-9 级容差会让"共面"被
      // 判成跨越；5e-6 比该松弛大一个量级，仍把薄于 0.0005% 对角线的切片视为退化。
      const eps = Math.max(diag * 5e-6, 1e-9)
      const dist = (x: number, y: number, z: number): number =>
        (x - point.x) * n.x + (y - point.y) * n.y + (z - point.z) * n.z
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < 8; i++) {
        const w = dist(
          i & 1 ? bb.xmax : bb.xmin,
          i & 2 ? bb.ymax : bb.ymin,
          i & 4 ? bb.zmax : bb.zmin,
        )
        if (w < lo) lo = w
        if (w > hi) hi = w
      }
      if (!(lo < -eps && hi > eps)) {
        throw new Error('splitByPlane: expected 2 solids, got 1')
      }
      const negative = track(k.cutPlane(shape as never, asArray(point), asArray(n)))
      const positive = track(
        k.cutPlane(shape as never, asArray(point), [-n.x, -n.y, -n.z]),
      )
      return { positive: positive as unknown as BrepHandle, negative: negative as unknown as BrepHandle }
    },

    // ── 倒角与圆角 ──
    chamfer(solid: BrepHandle, _edges: BrepHandle[], distance: number): BrepHandle {
      // 包壳为全局等宽倒角；edges 集合忽略（旧实现同口径）。
      return track(k.chamferEdges(solid as never, distance)) as unknown as BrepHandle
    },
    chamferDistAngle(_solid: BrepHandle, _edges: BrepHandle[], _distance: number, _angleDeg: number): BrepHandle {
      return unsupported('chamferDistAngle')
    },
    fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle {
      if (edges.length === 0) return track(k.brepCopy(solid as never)) as unknown as BrepHandle
      return track(k.filletEdges(solid as never, edges as never, radius)) as unknown as BrepHandle
    },
    filletVariable(_solid: BrepHandle, _edge: BrepHandle, _startRadius: number, _endRadius: number): BrepHandle {
      return unsupported('filletVariable')
    },
    filletWithHistory(
      solid: BrepHandle, edges: BrepHandle[], radius: number, inputFaceHashes: number[], hashUpperBound: number,
    ): BrepEvolutionData {
      const result = primitives.fillet(solid, edges, radius)
      const outHashes = new Set(primitives.subShapeHashes(result, 'face', hashUpperBound))
      return { result, modified: [], generated: [], deleted: inputFaceHashes.filter((h) => !outHashes.has(h)) }
    },

    // ── 变换（原地；包壳 transformMatrix 已吸收 SMLib 转置 quirk，适配器禁止再转置）──
    translate(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle {
      return onCopy(shape, (h) => k.translate(h as never, dx, dy, dz))
    },
    scale(shape: BrepHandle, center: BrepVec3, factor: number): BrepHandle {
      return onCopy(shape, (h) => k.scaleByPoint(h as never, center.x, center.y, center.z, factor))
    },
    transform(shape: BrepHandle, matrix: number[]): BrepHandle {
      if (matrix.length !== 12) throw new Error('[smlib-kernel] transform: matrix must be 12 elements (3×4 row-major)')
      return onCopy(shape, (h) => k.transformMatrix(h as never, matrix))
    },
    located(shape: BrepHandle, matrix: number[]): BrepHandle {
      return primitives.transform(shape, matrix)
    },
    locate(shape: BrepHandle, matrix: number[]): BrepHandle {
      return primitives.transform(shape, matrix)
    },
    generalTransform(shape: BrepHandle, matrix: number[]): BrepHandle {
      return primitives.transform(shape, matrix)
    },
    copy(shape: BrepHandle): BrepHandle {
      const cKids = compoundKidsOf(shape)
      if (cKids) return newCompound(cKids.map((kid) => primitives.copy(kid)))
      return track(k.brepCopy(shape as never)) as unknown as BrepHandle
    },
    copyShape(shape: BrepHandle): BrepHandle {
      return primitives.copy(shape)
    },
    composeTransform(m1: number[], m2: number[]): number[] {
      return composeTransform(m1, m2)
    },
    mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle {
      const n = normVec(normal)
      const r = (i: number, j: number): number => (i === j ? 1 : 0) - 2 * [n.x, n.y, n.z][i]! * [n.x, n.y, n.z][j]!
      const t = (i: number): number => 2 * dot(n, point) * [n.x, n.y, n.z][i]!
      const m = [
        r(0, 0), r(0, 1), r(0, 2), t(0),
        r(1, 0), r(1, 1), r(1, 2), t(1),
        r(2, 0), r(2, 1), r(2, 2), t(2),
      ]
      return primitives.transform(shape, m)
    },
    rotate(shape: BrepHandle, axis: { point: BrepVec3; direction: BrepVec3 }, angleRad: number): BrepHandle {
      const deg = (angleRad * 180) / Math.PI
      return onCopy(shape, (h) =>
        k.rotate(
          h as never,
          axis.point.x, axis.point.y, axis.point.z,
          axis.direction.x, axis.direction.y, axis.direction.z,
          deg,
        ),
      )
    },

    // ── 阵列 ──
    // 变换族已是 copy-then-transform（见 onCopy），这里**不能再显式 copy 一次** ——
    // 那样旋转/平移会作用在第二份副本上，push 出去的第一份仍是原样。
    linearPattern(shape: BrepHandle, direction: BrepVec3, spacing: number, count: number): BrepHandle[] {
      const out: BrepHandle[] = [shape]
      for (let i = 1; i < count; i++) {
        out.push(primitives.translate(shape, direction.x * spacing * i, direction.y * spacing * i, direction.z * spacing * i))
      }
      return out
    },
    circularPattern(shape: BrepHandle, center: BrepVec3, axis: BrepVec3, angleStep: number, count: number): BrepHandle[] {
      const out: BrepHandle[] = [shape]
      for (let i = 1; i < count; i++) {
        out.push(primitives.rotate(shape, { point: center, direction: axis }, (angleStep * i * Math.PI) / 180))
      }
      return out
    },
    gridPattern(
      _shape: BrepHandle, _directionX: BrepVec3, _directionY: BrepVec3,
      _spacingX: number, _spacingY: number, _countX: number, _countY: number,
    ): BrepHandle {
      return unsupported('gridPattern')
    },

    // ── 曲线构造 ──
    makeLineEdge(start: BrepVec3, end: BrepVec3): BrepHandle {
      return track(k.makeLineSegment(asArray(start), asArray(end))) as unknown as BrepHandle
    },
    makeArcEdge(start: BrepVec3, mid: BrepVec3, end: BrepVec3): BrepHandle {
      return threePointArc(start, mid, end)
    },
    makeBezierEdge(controlPoints: BrepVec3[]): BrepHandle {
      if (controlPoints.length < 2) throw new Error('[smlib-kernel] makeBezierEdge: need >= 2 control points')
      const degree = controlPoints.length - 1
      return track(
        k.makeCanonicalCurve(controlPoints.map(asArray), [0, 1], [degree + 1, degree + 1], undefined, degree, 6),
      ) as unknown as BrepHandle
    },
    makeBSplineEdge(
      poles: number[], weights: number[], knots: number[], multiplicities: number[], degree: number, _periodic?: boolean,
    ): BrepHandle {
      const pts: [number, number, number][] = []
      for (let i = 0; i < poles.length; i += 3) pts.push([poles[i]!, poles[i + 1]!, poles[i + 2]!])
      const w = weights && weights.length > 0 && weights.some((x) => x !== 1) ? weights : undefined
      return track(k.makeCanonicalCurve(pts, knots, multiplicities, w, degree, 6)) as unknown as BrepHandle
    },
    makeCircleEdge(center: BrepVec3, normal: BrepVec3, radius: number): BrepHandle {
      const c = track(k.makeCircle([0, 0, 0], radius))
      k.transformMatrix(c as never, circlePlacementMatrix(center, normal))
      return c as unknown as BrepHandle
    },
    makeCircleArc(center: BrepVec3, normal: BrepVec3, radius: number, startAngle: number, endAngle: number): BrepHandle {
      // circlePlacementMatrix 的局部 X = 世界 +X 投影 ⇒ 角度零补偿，直接喂世界角。
      // 跨度必须保留符号（`endAngle − startAngle`，CCW 为正），只把越界值整体平移 360。
      const norm360 = ((startAngle % 360) + 360) % 360
      const [a0, a1] = arcAnglePair(norm360, endAngle - startAngle)
      const c = track(k.makeArc([0, 0, 0], radius, a0, a1))
      k.transformMatrix(c as never, circlePlacementMatrix(center, normal))
      return c as unknown as BrepHandle
    },
    makeHelixWire(
      origin: BrepVec3, axis: BrepVec3, pitch: number, height: number, radius: number, leftHanded?: boolean,
    ): BrepHandle {
      const turns = height / pitch
      const c = track(k.makeHelix([0, 0, 0], height, radius, radius, turns, !leftHanded, 1e-3))
      k.transformMatrix(c as never, circlePlacementMatrix(origin, axis))
      return c as unknown as BrepHandle
    },
    approximatePoints(points: BrepVec3[], _tolerance?: number): BrepHandle {
      return track(k.curveApproxPoints(points.map(asArray))) as unknown as BrepHandle
    },
    interpolatePointsWithTangents(points: BrepVec3[], _startTangent: BrepVec3, _endTangent: BrepVec3): BrepHandle {
      return primitives.interpolatePoints(points, 3)
    },
    curveSplit(_edge: BrepHandle, _param: number): [BrepHandle, BrepHandle] {
      return unsupported('curveSplit')
    },

    // ── 拓扑构造 ──
    makeWire(edges: BrepHandle[]): BrepHandle {
      if (edges.length === 0) throw new Error('[smlib-kernel] makeWire: need >= 1 edge')
      // smlib **没有独立的 Edge 实体**：makeLineEdge / makeArcEdge / makeBezierEdge 产出的
      // 是 curve 句柄（`smw_make_line_segment` 等直接返回 Curve slot）。所以这里必须按
      // kind 分派——curve 直接收，edge 才走 edgeToCurve。对 curve 也调 edgeToCurve 会把
      // curve id 当 edge 解引用，内核报 `smw_curve_type failed: bad edge id <curveId>`
      // （cad.wire 三点折线在端侧的实测症状，2026-10-31）。
      const curves = edges.map((e) => {
        const n = e as unknown as number
        if (isSynthetic(n)) {
          throw new Error('[smlib-kernel] makeWire: synthetic handle (wire/vertex/compound) cannot be a wire edge')
        }
        return k.kindOf(n) === SmwKind.Curve ? n : (k.edgeToCurve(e as never) as unknown as number)
      })
      return newWire(curves)
    },
    makeFace(wire: BrepHandle): BrepHandle {
      const curves = wireHandles.get(wire as unknown as number)
      if (!curves || curves.length === 0) throw new Error('[smlib-kernel] makeFace: not a makeWire handle')
      return track(k.planarFaces(curves as never)) as unknown as BrepHandle
    },
    makeCompound(shapes: BrepHandle[]): BrepHandle {
      if (shapes.length === 0) throw new Error('[smlib-kernel] makeCompound: need >= 1 shape')
      if (shapes.length === 1) return shapes[0]!
      return newCompound(shapes)
    },
    addHolesInFace(face: BrepHandle, holeWires: BrepHandle[]): BrepHandle {
      const outer = faceOuterCurves(face as unknown as number)
      if (outer.length === 0) throw new Error('[smlib-kernel] addHolesInFace: no outer curves from face')
      const holes: number[] = []
      for (const w of holeWires) {
        const curves = wireHandles.get(w as unknown as number)
        if (!curves || curves.length === 0) throw new Error('[smlib-kernel] addHolesInFace: not a makeWire handle')
        holes.push(...curves)
      }
      return track(k.planarFaces([...outer, ...holes] as never)) as unknown as BrepHandle
    },
    buildTriFace(a: BrepVec3, b: BrepVec3, c: BrepVec3): BrepHandle {
      const curves = [
        primitives.makeLineEdge(a, b),
        primitives.makeLineEdge(b, c),
        primitives.makeLineEdge(c, a),
      ].map((h) => h as unknown as number)
      return track(k.planarFaces(curves as never)) as unknown as BrepHandle
    },
    makeNonPlanarFace(_wire: BrepHandle): BrepHandle {
      return unsupported('makeNonPlanarFace')
    },

    // ── 三角化 ──
    meshShape(shape: BrepHandle, options?: BrepTessellateOptions): BrepMeshResult {
      const cKids = compoundKidsOf(shape)
      if (cKids) {
        const pos: number[] = []
        const nor: number[] = []
        const idx: number[] = []
        const fg: number[] = []
        let vertexBase = 0
        for (const kid of cKids) {
          const m = primitives.meshShape(kid, options)
          const vBase = pos.length / 3
          for (let i = 0; i < m.positions.length; i++) pos.push(m.positions[i]!)
          for (let i = 0; i < m.normals.length; i++) nor.push(m.normals[i]!)
          for (let i = 0; i < m.indices.length; i++) idx.push(m.indices[i]! + vBase)
          const f = m.faceGroups ?? new Int32Array(0)
          for (let i = 0; i < f.length; i += 3) {
            fg.push(f[i]! + vertexBase * 3, f[i + 1]!, f[i + 2]!)
          }
          vertexBase += m.vertexCount
        }
        return {
          positions: new Float32Array(pos),
          normals: new Float32Array(nor),
          indices: new Uint32Array(idx),
          vertexCount: vertexBase,
          triangleCount: idx.length / 3,
          faceGroups: new Int32Array(fg),
          faceCount: fg.length / 3,
        }
      }
      const n = shape as unknown as number
      if (isSynthetic(n)) {
        // 合成 wire：1D 曲线无三角载荷，短路返回空网格。
        return {
          positions: new Float32Array(0),
          normals: new Float32Array(0),
          indices: new Uint32Array(0),
          vertexCount: 0,
          triangleCount: 0,
        }
      }
      const chord = options?.linearDeflection
      const angRad = options?.angularDeflection
      const params: Record<string, number> = {}
      if (typeof chord === 'number' && chord > 0) params.chordHeightTol = chord
      if (typeof angRad === 'number' && angRad > 0) {
        const deg = (angRad * 180) / Math.PI
        params.curveAngleTolDeg = deg
        params.surfaceAngleTolDeg = deg
      }
      const mesh = k.tessellate(n as never, Object.keys(params).length > 0 ? params : undefined)
      try {
        const data = k.tessellateData(mesh)
        if (!data) throw new Error('[smlib-kernel] meshShape: tessellateData returned null')
        const rawGroups = data.groups
        const groupOut: number[] = []
        let lastGroupCode = Number.NaN
        for (let i = 0; i < rawGroups.length; i += 3) {
          const triStart = rawGroups[i]!
          const triCount = rawGroups[i + 1]!
          const faceIndex = rawGroups[i + 2]!
          const code = faceIndex === 0xffffffff ? -1 : ordinalHash(n, faceIndex, BREP_HASH_BOUND)
          if (groupOut.length > 0 && lastGroupCode === code) {
            const firstTriStart = groupOut[groupOut.length - 3]! / 3
            groupOut[groupOut.length - 2]! = (triStart + triCount - firstTriStart) * 3
          } else {
            groupOut.push(triStart * 3, triCount * 3, code)
            lastGroupCode = code
          }
        }
        const faceGroups = new Int32Array(groupOut)
        return {
          positions: data.positions,
          normals: data.normals,
          indices: data.indices,
          vertexCount: data.positions.length / 3,
          triangleCount: data.indices.length / 3,
          faceGroups,
          faceCount: faceGroups.length / 3,
        }
      } finally {
        k.meshRelease(mesh)
      }
    },
    wireframe(shape: BrepHandle, deflection?: number): BrepEdgeData {
      const cKids = compoundKidsOf(shape)
      if (cKids) {
        const points: number[] = []
        const edgeGroups: number[] = []
        let edgeCount = 0
        for (const kid of cKids) {
          const w = primitives.wireframe(kid, deflection)
          const pBase = points.length / 3
          for (let i = 0; i < w.points.length; i++) points.push(w.points[i]!)
          const g = w.edgeGroups
          for (let i = 0; i < g.length; i += 3) {
            edgeGroups.push(g[i]! + pBase * 3, g[i + 1]!, g[i + 2]!)
          }
          edgeCount += w.edgeCount
        }
        return {
          points: new Float32Array(points),
          edgeGroups: new Int32Array(edgeGroups),
          pointCount: points.length,
          edgeCount,
        }
      }
      const n = shape as unknown as number
      if (isSynthetic(n)) {
        return { points: new Float32Array(0), edgeGroups: new Int32Array(0), pointCount: 0, edgeCount: 0 }
      }
      const mesh = k.wireframe(n as never, deflection ?? 0)
      try {
        const data = k.wireframeData(mesh)
        if (!data) throw new Error('[smlib-kernel] wireframe: wireframeData returned null')
        const f32 = new Float32Array(data.points.length)
        for (let i = 0; i < data.points.length; i++) f32[i] = data.points[i]!
        const edgeIndex = new Map<number, number>()
        k.edges(n as never).forEach((e, i) => edgeIndex.set(e as unknown as number, i))
        const edgeGroups = new Int32Array(data.counts.length * 3)
        let pointStart = 0
        for (let i = 0; i < data.counts.length; i++) {
          const count = data.counts[i]!
          const ord = edgeIndex.get(data.edges[i]! as unknown as number) ?? 0
          edgeGroups[i * 3] = pointStart * 3
          edgeGroups[i * 3 + 1] = count * 3
          edgeGroups[i * 3 + 2] = ordinalHash(n, ord, BREP_HASH_BOUND)
          pointStart += count
        }
        return { points: f32, edgeGroups, pointCount: data.points.length, edgeCount: data.counts.length }
      } finally {
        k.meshRelease(mesh)
      }
    },

    // ── 拓扑查询 ──
    getSubShapes(shape: BrepHandle, type: BrepSubShapeType): BrepHandle[] {
      const cKids = compoundKidsOf(shape)
      if (cKids) {
        if (type === 'solid' || type === 'shell') {
          const out: BrepHandle[] = []
          const walk = (s: BrepHandle): void => {
            const inner = compoundKidsOf(s)
            if (inner) {
              for (const kid of inner) walk(kid)
            } else {
              out.push(s)
            }
          }
          for (const kid of cKids) walk(kid)
          return out
        }
        const out: BrepHandle[] = []
        for (const kid of cKids) out.push(...primitives.getSubShapes(kid, type))
        return out
      }
      const n = shape as unknown as number
      if (isSynthetic(n)) {
        if (type === 'edge') {
          const curves = wireHandles.get(n) ?? []
          curves.forEach((curve, index) => recordSubShape(n, index, curve))
          return curves.map((c) => c as unknown as BrepHandle)
        }
        if (type === 'vertex') return []
        if (type !== 'wire') return []
      }
      const kind = k.kindOf(n)
      if (type === 'solid') return kind === SmwKind.Solid ? [shape] : unsupported(`getSubShapes(${type})`)
      if (type === 'shell') return kind === SmwKind.Solid ? [shape] : unsupported(`getSubShapes(${type})`)
      // OCCT 语义：face 的子形状 face 就是它自己（TopExp_Explorer(face, TopAbs_FACE) 首项为自身）。
      if (type === 'face' && kind === SmwKind.Face) return [shape]
      // face → 边界环 wire（合成）。索引 0 = 外环，见 faceWireCache 注释。
      if (type === 'wire' && kind === SmwKind.Face) {
        return faceWires(n)
      }
      // solid → 全部面内的全部边界环（OCCT `TopExp_Explorer(solid, TopAbs_WIRE)` 语义）。
      // 为什么需要：`smw_planar_faces` 产出的"平面片"在内核里是 **Solid** 句柄
      // （`shapeType` 实测 'SOLID'），而 `cad.profile` 走的就是它 —— 于是
      // `profile-wire.ts` 的「面 → 外环」在 smlib 上实际是「solid → 外环」。
      if (type === 'wire' && kind === SmwKind.Solid) {
        const out: BrepHandle[] = []
        for (const f of primitives.getSubShapes(shape, 'face')) out.push(...faceWires(f as unknown as number))
        return out
      }
      if (type === 'wire') {
        const curves = wireHandles.get(n)
        if (curves) {
          curves.forEach((curve, index) => recordSubShape(n, index, curve))
          return curves.map((c) => c as unknown as BrepHandle)
        }
        return unsupported(`getSubShapes(${type})`)
      }
      if (type === 'vertex') {
        const edges = primitives.getSubShapes(shape, 'edge')
        const out: BrepHandle[] = []
        const seen = new Map<string, BrepHandle>()
        for (const e of edges) {
          const [p0, p1] = k.edgeVertices(e as never)
          for (const p of [p0, p1]) {
            const key = `${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)}`
            if (!seen.has(key)) {
              const h = VERTEX_TAG + nextVertexId++
              vertexHandles.set(h, { x: p[0]!, y: p[1]!, z: p[2]! })
              seen.set(key, h as BrepHandle)
              out.push(h as BrepHandle)
            }
          }
        }
        return out
      }
      if (type === 'edge' && kind === SmwKind.Face) {
        const loops = k.faceLoops(n as never)
        const out: BrepHandle[] = []
        loops.loops.forEach((loop) => loop.edges.forEach((edge) => {
          recordSubShape(n, out.length, edge)
          out.push(edge as unknown as BrepHandle)
        }))
        return out
      }
      if (type === 'face' && kind === SmwKind.Solid) {
        const faces = k.faces(n as never) as unknown as BrepHandle[]
        faces.forEach((face, index) => recordSubShape(n, index, face))
        return faces
      }
      if (type === 'edge' && kind === SmwKind.Solid) {
        const edges = k.edges(n as never) as unknown as BrepHandle[]
        edges.forEach((edge, index) => recordSubShape(n, index, edge))
        return edges
      }
      return unsupported(`getSubShapes(${type})`)
    },
    subShapeHashes(shape: BrepHandle, type: BrepSubShapeType, hashUpperBound: number): number[] {
      const cKids = compoundKidsOf(shape)
      if (cKids) {
        const out: number[] = []
        for (const kid of cKids) out.push(...primitives.subShapeHashes(kid, type, hashUpperBound))
        return out
      }
      const n = shape as unknown as number
      const kind = k.kindOf(n)
      if (type === 'face' && kind === SmwKind.Solid) {
        return k.faces(n as never).map((_, i) => ordinalHash(n, i, hashUpperBound))
      }
      if (type === 'edge' && kind === SmwKind.Solid) {
        return k.edges(n as never).map((_, i) => ordinalHash(n, i, hashUpperBound))
      }
      if (type === 'edge' && kind === SmwKind.Face) {
        return primitives.getSubShapes(shape, 'edge').map((_, i) => ordinalHash(n, i, hashUpperBound))
      }
      if (type === 'edge' && isSynthetic(n)) {
        return (wireHandles.get(n) ?? []).map((_, i) => ordinalHash(n, i, hashUpperBound))
      }
      return primitives.getSubShapes(shape, type).map((_, i) => ordinalHash(n, i, hashUpperBound))
    },
    hashCode(shape: BrepHandle, upperBound: number): number {
      const n = shape as unknown as number
      const info = subShapeOrdinal.get(n)
      if (info && info.epoch === shapeEpoch) return ordinalHash(info.owner, info.index, upperBound)
      return ordinalHash(n, 0, upperBound)
    },
    isSame(a: BrepHandle, b: BrepHandle): boolean {
      return a === b
    },
    isSolid(shape: BrepHandle): boolean {
      if (compoundKidsOf(shape)) return false
      const n = shape as unknown as number
      return k.kindOf(n) === SmwKind.Solid && k.isManifold(n as never)
    },
    subShapeCount(shape: BrepHandle, type: BrepSubShapeType): number {
      return primitives.getSubShapes(shape, type).length
    },
    shapeType(shape: BrepHandle): string {
      const n = shape as unknown as number
      if (compoundHandles.has(n)) return 'COMPOUND'
      if (wireHandles.has(n)) return 'WIRE'
      if (vertexHandles.has(n)) return 'VERTEX'
      switch (k.kindOf(n)) {
        case SmwKind.Solid: return 'SOLID'
        case SmwKind.Face: return 'FACE'
        case SmwKind.Edge: return 'EDGE'
        case SmwKind.Curve: return 'CURVE'
        case SmwKind.Surface: return 'SURFACE'
        default: return unsupported('shapeType(non-solid)')
      }
    },
    shapeOrientation(_shape: BrepHandle): string {
      return unsupported('shapeOrientation')
    },
    edgeToFaceMap(shape: BrepHandle): unknown {
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
      const as = new Set(primitives.getSubShapes(a, 'edge').map((e) => e as unknown as number))
      return primitives.getSubShapes(b, 'edge').filter((e) => as.has(e as unknown as number))
    },

    // ── 几何求值 ──
    curveType(edge: BrepHandle): string {
      const code = k.curveType(edge as never)
      return code === 0 ? 'line' : code === 1 ? 'circle' : code === 2 ? 'ellipse' : code === 3 ? 'bspline' : 'other'
    },
    curvePointAtParam(edge: BrepHandle, param: number): BrepVec3 {
      const p = k.curvePointAtParam(edge as never, param)
      return { x: p[0]!, y: p[1]!, z: p[2]! }
    },
    curveTangent(edge: BrepHandle, param: number): BrepVec3 {
      const p = k.curveTangent(edge as never, param)
      return { x: p[0]!, y: p[1]!, z: p[2]! }
    },
    curveParameters(edge: BrepHandle): BrepCurveParameters {
      const [first, last] = k.curveParameters(edge as never)
      return { first, last }
    },
    curveIsClosed(edge: BrepHandle): boolean {
      return k.curveIsClosed(edge as never)
    },
    curveLength(edge: BrepHandle): number {
      return k.curveLength(edge as never)
    },
    surfaceType(face: BrepHandle): string {
      const code = k.surfaceType(face as never)
      switch (code) {
        case 0: return 'plane'
        case 1: return 'cylinder'
        case 2: return 'cone'
        case 3: return 'sphere'
        case 4: return 'torus'
        case 5: return 'bspline'
        default: return 'other'
      }
    },
    surfaceNormal(face: BrepHandle, u: number, v: number): BrepVec3 {
      const p = k.surfaceNormal(face as never, u, v)
      return { x: p[0]!, y: p[1]!, z: p[2]! }
    },
    pointOnSurface(face: BrepHandle, u: number, v: number): BrepVec3 {
      const p = k.surfacePoint(face as never, u, v)
      return { x: p[0]!, y: p[1]!, z: p[2]! }
    },
    uvBounds(face: BrepHandle): BrepUvBounds {
      const b = k.faceUvBounds(face as never)
      return { uMin: b.u[0]!, uMax: b.u[1]!, vMin: b.v[0]!, vMax: b.v[1]! }
    },
    surfaceCenterOfMass(face: BrepHandle): BrepVec3 {
      const c = k.faceCentroid(face as never, 1e-4).centroid
      return { x: c[0]!, y: c[1]!, z: c[2]! }
    },
    vertexPosition(vertex: BrepHandle): BrepVec3 {
      const v = vertexHandles.get(vertex as unknown as number)
      if (!v) return unsupported('vertexPosition')
      return v
    },
    containsPoint(shape: BrepHandle, point: BrepVec3, tolerance: number): boolean {
      const cKids = compoundKidsOf(shape)
      if (cKids) return cKids.some((kid) => primitives.containsPoint(kid, point, tolerance))
      const n = shape as unknown as number
      if (k.kindOf(n) !== SmwKind.Solid) {
        throw new Error(
          '[smlib-kernel] containsPoint: only solid handles are classifiable ' +
          `(handle=${n}; pass the owning solid, not a face/edge)`,
        )
      }
      const cache = triCacheOf(k.memory)
      let mesh = cache.get(n)
      if (!mesh) {
        const m = primitives.meshShape(shape)
        mesh = { positions: m.positions, indices: m.indices }
        if (cache.size >= 8) cache.clear()
        cache.set(n, mesh)
      }
      void tolerance
      return rayCrossings(mesh, point, PARITY_RAY_DIR) % 2 === 1
    },
    getFaceCylinderData(_face: BrepHandle): { radius: number } | null {
      return null
    },
    getNurbsCurveData(_edge: BrepHandle): BrepNurbsCurveData | null {
      return unsupported('getNurbsCurveData')
    },
    interpolatePoints(points: BrepVec3[], _degree: number): BrepHandle {
      if (points.length < 4) throw new Error('[smlib-kernel] interpolatePoints: need >= 4 points')
      return track(k.curveInterpPoints(points.map(asArray), 1)) as unknown as BrepHandle
    },

    defeature(_shape: BrepHandle, _faces: BrepHandle[]): BrepHandle {
      return unsupported('defeature')
    },
    draft(_shape: BrepHandle, _faces: BrepHandle[], _pull: BrepVec3, _neutral: BrepVec3, _angleDeg: number): BrepHandle {
      return unsupported('draft')
    },
    removeHolesFromFace(_face: BrepHandle): BrepHandle {
      return unsupported('removeHolesFromFace')
    },
    reverseShape(_shape: BrepHandle): BrepHandle {
      return unsupported('reverseShape')
    },
    projectEdges(
      _shape: BrepHandle, _origin: BrepVec3, _direction: BrepVec3, _xAxis: BrepVec3,
      _hiddenLines: boolean, _deflection: number,
    ): unknown {
      return unsupported('projectEdges')
    },

    // ── 测量 ──
    getBoundingBox(shape: BrepHandle, useTriangulation?: boolean): BrepBoundingBox {
      const cKids = compoundKidsOf(shape)
      if (cKids) {
        let xmin = Infinity, ymin = Infinity, zmin = Infinity
        let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
        for (const kid of cKids) {
          const b = primitives.getBoundingBox(kid, useTriangulation)
          xmin = Math.min(xmin, b.xmin); ymin = Math.min(ymin, b.ymin); zmin = Math.min(zmin, b.zmin)
          xmax = Math.max(xmax, b.xmax); ymax = Math.max(ymax, b.ymax); zmax = Math.max(zmax, b.zmax)
        }
        return { xmin, ymin, zmin, xmax, ymax, zmax }
      }
      const n = shape as unknown as number
      if (isSynthetic(n)) return unsupported('getBoundingBox')
      const kind = k.kindOf(n)
      const tight = useTriangulation ? true : false
      let bb
      if (kind === SmwKind.Face) bb = k.faceBBox(n as never, tight)
      else if (kind === SmwKind.Edge) bb = k.edgeBBox(n as never, tight)
      else if (kind === SmwKind.Solid) bb = k.bbox(n as never, tight)
      else return unsupported('getBoundingBox')
      return {
        xmin: bb.min[0]!, ymin: bb.min[1]!, zmin: bb.min[2]!,
        xmax: bb.max[0]!, ymax: bb.max[1]!, zmax: bb.max[2]!,
      }
    },
    getVolume(shape: BrepHandle): number {
      const cKids = compoundKidsOf(shape)
      if (cKids) {
        let total = 0
        for (const kid of cKids) total += primitives.getVolume(kid)
        return total
      }
      return k.volume(shape as never)
    },
    getCenterOfMass(shape: BrepHandle): BrepVec3 {
      const cKids = compoundKidsOf(shape)
      if (cKids) {
        let wx = 0, wy = 0, wz = 0, totalV = 0
        for (const kid of cKids) {
          const v = primitives.getVolume(kid)
          const c = primitives.getCenterOfMass(kid)
          wx += c.x * v; wy += c.y * v; wz += c.z * v
          totalV += v
        }
        if (totalV === 0) return { x: 0, y: 0, z: 0 }
        return { x: wx / totalV, y: wy / totalV, z: wz / totalV }
      }
      const c = k.massProperties(shape as never, { acc: 1e-4 }).center
      return { x: c[0]!, y: c[1]!, z: c[2]! }
    },
    getSurfaceArea(shape: BrepHandle): number {
      const cKids = compoundKidsOf(shape)
      if (cKids) {
        let total = 0
        for (const kid of cKids) total += primitives.getSurfaceArea(kid)
        return total
      }
      return k.area(shape as never, 1e-8)
    },
    getLength(shape: BrepHandle): number {
      const edges = new Set(primitives.getSubShapes(shape, 'edge').map((e) => e as unknown as number))
      let total = 0
      for (const e of edges) total += primitives.curveLength(e as BrepHandle)
      return total
    },

    // ── 校验与修复 ──
    isValid(shape: BrepHandle): boolean {
      return primitives.isSolid(shape)
    },
    unifySameDomain(_shape: BrepHandle): BrepHandle {
      return unsupported('unifySameDomain')
    },
    healSolid(shape: BrepHandle, _tolerance?: number): BrepHandle {
      const cKids = compoundKidsOf(shape)
      if (cKids) return newCompound(cKids.map((kid) => primitives.healSolid(kid, _tolerance)))
      const result = track(k.healSolid(shape as never))
      if (!k.isManifold(result as never)) {
        throw new Error('[smlib-kernel] healSolid: result is not a manifold solid (heal false-success guard)')
      }
      return result as unknown as BrepHandle
    },
    fixShape(shape: BrepHandle): BrepHandle {
      return primitives.healSolid(shape)
    },
    fixFaceOrientations(shape: BrepHandle): BrepHandle {
      const cKids = compoundKidsOf(shape)
      if (cKids) return newCompound(cKids.map((kid) => primitives.fixFaceOrientations(kid)))
      const copy = track(k.brepCopy(shape as never))
      k.unifyNormals(copy as never, 16)
      return copy as unknown as BrepHandle
    },
    removeDegenerateEdges(_shape: BrepHandle, _tolerance?: number): BrepHandle {
      return unsupported('removeDegenerateEdges')
    },

    // ── IO ──
    importStep(data: string | ArrayBuffer): BrepHandle {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
      if (bytes.byteLength === 0) throw new Error('[smlib-kernel] importStep: empty payload')
      try {
        const id = k.importStep(bytes, STEP_IMPORT_TOL_MM)
        return track(id) as unknown as BrepHandle
      } catch (e) {
        if (e instanceof SmlibError) throw new Error(`importStep failed: SM status ${e.smStatus}`, { cause: e })
        throw e
      }
    },
    exportStep(shape: BrepHandle): string {
      const cKids = compoundKidsOf(shape)
      if (cKids) return mergeStepEntities(cKids.map((kid) => primitives.exportStep(kid)))
      const bytes = k.exportStep(shape as never, 0)
      if (bytes.length === 0) throw new Error('[smlib-kernel] exportStep: kernel returned empty STEP')
      return new TextDecoder().decode(bytes)
    },
    importStl(data: string | ArrayBuffer): BrepHandle {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
      if (bytes.byteLength < 84) {
        throw new Error('[smlib-kernel] importStl: payload shorter than an 84-byte binary STL header')
      }
      const id = k.importStl(bytes, STL_WELD_TOL_MM)
      return track(id) as unknown as BrepHandle
    },
    fromBREP(_data: string): BrepHandle {
      return unsupported('fromBREP')
    },

    // ── 面演化（集合差实现；modified/generated 空，deleted 为消失面 hash）──
    cutWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const result = primitives.cut(a, b)
      const outHashes = new Set(primitives.subShapeHashes(result, 'face', hashUpperBound))
      return { result, modified: [], generated: [], deleted: inputFaceHashes.filter((h) => !outHashes.has(h)) }
    },
    fuseWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const result = primitives.fuse(a, b)
      const outHashes = new Set(primitives.subShapeHashes(result, 'face', hashUpperBound))
      return { result, modified: [], generated: [], deleted: inputFaceHashes.filter((h) => !outHashes.has(h)) }
    },
    intersectWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const result = primitives.intersect(a, b)
      const outHashes = new Set(primitives.subShapeHashes(result, 'face', hashUpperBound))
      return { result, modified: [], generated: [], deleted: inputFaceHashes.filter((h) => !outHashes.has(h)) }
    },
  }

  primitivesSingleton = primitives
  return primitives
}

/** 返回已就绪的 smlib 原语集合（未初始化则抛错）。
 * @returns the ready smlib primitives singleton.
 * @throws if smlib primitives are not initialized.
 */
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
