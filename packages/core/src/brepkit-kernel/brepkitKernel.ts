/**
 * brepkit-kernel/brepkitKernel — brepkit 内核 → faijs BrepEngineApi 适配器
 *
 * Phase 4（docs/plans/2026-09-24-brep-engine-api-narrowing-native-access.md）：
 * 本文件是 L1 契约 `BrepEngineApi` 的 **brepkit 显式对象字面量实现**——与 occt 侧
 * `occt-primitives.ts` 同构：逐方法接线、方言在适配器内消化、零 `unsupported()` 桩。
 *
 * 契约面收窄后 L1 只含 occt/brepkit 双方**语义可对齐**的方法（唯一真源：
 * `api/surface/engine-method-map.json` 的 aligned/dialect 条目）。brepkit 独有
 * 能力（chamfer2d/chamferV2/filletV2/sketch* 族、serializeSolid、meshBoolean、
 * minkowskiSum …）与单方语义（loft、平面 section/split 之外的 splitter 语义…）
 * 都不在本对象里——平台代码经原生面 `getBrepkitKernel()`（D3）访问。
 *
 * 设计要点（对应 3d_editor 项目的 weapp-voice-ai-modeling 设计计划 §5）：
 * - 句柄：brepkit u32 句柄与 faijs BrepHandle(number) 同构，直通零转换；
 * - 拓扑红线：meshShape 用 tessellateSolidGrouped 输出 faceGroups，与三角化几何同源；
 * - 面溯源：布尔/倒角走 *WithEvolution，映射为 BrepEvolutionData（hash 编码）；
 * - 链纪律：kernel.meshFallbackCount 计数差 > 0 → getMeshFallbackCount 暴露给宿主，
 *   由宿主标记 BREP 链中断（不在此层静默处理）。
 */

import { initBrepkitWasm, type BrepKitKernel } from './brepkitWasm'
import type { BrepEngineApi } from '../brep/engine/primitives'
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
} from '../brep/engine/types'

// ── 句柄桥接：brepkit number 句柄 ↔ BrepHandle（零运行时成本，与 occt 适配器同构） ──
const asHandle = (n: number): BrepHandle => n as BrepHandle
const asNum = (h: BrepHandle): number => h as unknown as number
const arr = (x: ArrayLike<number> | number[]): number[] => Array.from(x as ArrayLike<number>)

/** 适配器内部的显式失败（替代旧 unsupported 桩：能力缺失一律在静态判定拦截，不在实现体里伪装）。 */
function fail(detail: string): never {
  throw new Error(`[brepkit-kernel] ${detail}`)
}

/**
 * brepkit 几何查询返回值归一为 number[]。
 *
 * 关键事实（npm brepkit-wasm d.ts 与本地 web-target 胶水一致）：
 *   getSurfaceDomain / getFaceNormal / evaluateSurfaceNormal / evaluateSurface /
 *   evaluateEdgeCurve / evaluateEdgeCurveD1 / getEdgeCurveParameters / centerOfMass
 *   返回 **Float64Array**（不是 JSON 字符串）；
 *   仅 getAnalyticSurfaceParams / getNurbsCurveData / tessellateSolidGrouped /
 *   *WithEvolution 返回 JSON 字符串。
 *
 * 历史 bug：曾误以为全部返回 JSON 字符串而统一 JSON.parse，导致
 * `String(Float64Array)` 变成逗号拼接数字串（如 "-1000000,1000000,..."），
 * JSON.parse 在第一个逗号处抛 "Unexpected non-whitespace character after JSON"。
 * 这里同时兼容：JSON 字符串 / TypedArray / 普通数组 / {x,y,z} / 数字键对象。
 */
function toNumArray(v: unknown): number[] {
  if (typeof v === 'string') {
    const parsed: unknown = JSON.parse(v)
    if (Array.isArray(parsed)) return parsed.map(Number)
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>
      if (typeof o.x === 'number') return [o.x, Number(o.y), Number(o.z)]
      if (o[0] !== undefined) {
        const out: number[] = []
        for (let i = 0; o[i] !== undefined; i++) out.push(Number(o[i]))
        return out
      }
    }
    return []
  }
  if (v && typeof v === 'object') {
    if (Array.isArray(v)) return v.map(Number)
    if ('length' in v) return Array.from(v as ArrayLike<number>, Number)
    const o = v as Record<string, unknown>
    if (typeof o.x === 'number') return [o.x, Number(o.y), Number(o.z)]
    if (o[0] !== undefined) {
      const out: number[] = []
      for (let i = 0; o[i] !== undefined; i++) out.push(Number(o[i]))
      return out
    }
  }
  return []
}

/** 面稳定指纹：解析曲面参数 + 面积 → FNV-1a → 取模上界（跨操作可追溯，与句柄无关）。 */
function faceFingerprint(kernel: BrepKitKernel, face: number, upperBound: number): number {
  let params = ''
  try { params = String(kernel.getAnalyticSurfaceParams(face) ?? '') } catch { /* 非解析面 */ }
  let area = 0
  try { area = Number(kernel.faceArea?.(face, 0.1) ?? 0) } catch { /* 查询失败用 0 */ }
  const basis = `${params}|${area.toFixed(6)}`
  let h = 0x811c9dc5
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return upperBound > 0 ? h % upperBound : h
}

/** 面演化数据（BrepEvolutionData）：brepkit evolution JSON → hash 编码三元组。 */
function mapEvolution(
  kernel: BrepKitKernel,
  raw: string,
  resultHandle: number,
  inputFaceHashes: number[],
  hashUpperBound: number,
): BrepEvolutionData {
  // raw: {solid, evolution:{modified:{oldHandle:[newHandles]}, generated:{oldHandle:[new]}, deleted:[oldHandles]}}
  const parsed = JSON.parse(raw) as {
    solid: number
    evolution: { modified: Record<string, number[]>; generated: Record<string, number[]>; deleted: number[] }
  }
  const evo = parsed.evolution ?? { modified: {}, generated: {}, deleted: [] }
  const modifiedKeys = new Set(Object.keys(evo.modified ?? {}).map(Number))
  const deletedKeys = new Set((evo.deleted ?? []).map(Number))
  // 输入面 hash → 是否被改/删：通过该输入面在输入 hash 快照中的位置无法直接回溯句柄，
  // 诚实映射：modified/deleted 用"发生变化的输入句柄数 == 输入面数"的对齐近似——
  // v1 精确溯源依赖 per-shape hash 注册表（subShapeHashes 时登记 hash↔handle）。
  const registry = hashRegistry.get(kernel)
  const modified: number[] = []
  const deleted: number[] = []
  if (registry) {
    for (const [hash, handle] of registry) {
      if (modifiedKeys.has(handle)) modified.push(hash)
      if (deletedKeys.has(handle)) deleted.push(hash)
    }
  }
  // generated：结果实体的新面 hash（数量按 generated 表展开）
  const generated: number[] = []
  for (const news of Object.values(evo.generated ?? {})) {
    for (const nh of news) generated.push(faceFingerprint(kernel, nh, hashUpperBound))
  }
  // 更新注册表：结果实体 faces 的最新 hash 登记（供下一次演化对齐）
  try {
    const faces = arr(kernel.getSolidFaces(resultHandle))
    const reg = registry ?? new Map<number, number>()
    for (const f of faces) reg.set(faceFingerprint(kernel, f, hashUpperBound), f)
    hashRegistry.set(kernel, reg)
  } catch { /* 非实体结果跳过登记 */ }
  return { result: asHandle(resultHandle), modified, generated, deleted }
}

/** per-kernel 的 hash↔handle 登记表（fuseWithHistory 溯源对齐用）。 */
const hashRegistry = new WeakMap<BrepKitKernel, Map<number, number>>()

/** brepkit 适配器返回类型：BrepEngineApi + brepkit 专属诊断。 */
type BrepkitEngineExtras = BrepEngineApi & { getMeshFallbackCount(): number }

/** 三点外接圆（makeArcEdge 方言消化：occt 吃 3 点，brepkit 吃圆心+轴）。 */
function circumcircle(a: BrepVec3, b: BrepVec3, c: BrepVec3): { center: BrepVec3; axis: BrepVec3 } {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z
  const nx = aby * acz - abz * acy
  const ny = abz * acx - abx * acz
  const nz = abx * acy - aby * acx
  const n2 = nx * nx + ny * ny + nz * nz
  if (n2 < 1e-18) fail('makeArcEdge: 3 points are collinear (no circumscribed circle)')
  const ab2 = abx * abx + aby * aby + abz * abz
  const ac2 = acx * acx + acy * acy + acz * acz
  // center = a + ( ac2·(ab×n) + ab2·(n×ac) ) / (2·n²)
  const abxnx = aby * nz - abz * ny, abxny = abz * nx - abx * nz, abxnz = abx * ny - aby * nx
  const nxacx = ny * acz - nz * acy, nxacy = nz * acx - nx * acz, nxacz = nx * acy - ny * acx
  const denom = 2 * n2
  const len = Math.sqrt(n2)
  return {
    center: {
      x: a.x + (ac2 * abxnx + ab2 * nxacx) / denom,
      y: a.y + (ac2 * abxny + ab2 * nxacy) / denom,
      z: a.z + (ac2 * abxnz + ab2 * nxacz) / denom,
    },
    axis: { x: nx / len, y: ny / len, z: nz / len },
  }
}

/** BrepVec3[] → 扁平 Float64Array（brepkit 坐标数组方言）。 */
function flattenPoints(points: BrepVec3[]): Float64Array {
  const out = new Float64Array(points.length * 3)
  for (let i = 0; i < points.length; i++) {
    out[i * 3] = points[i].x
    out[i * 3 + 1] = points[i].y
    out[i * 3 + 2] = points[i].z
  }
  return out
}

/**
 * 创建 brepkit BrepEngineApi 实现（L1 契约显式对象字面量）。
 * 与 occt 的 createOcctPrimitives 同位：返回满足引擎契约的原语集合。
 * @returns a promise resolving to the BrepEngineApi implementation plus brepkit-specific
 * diagnostics (`getMeshFallbackCount`).
 */
export async function createBrepkitPrimitives(): Promise<BrepkitEngineExtras> {
  const kernel = await initBrepkitWasm()
  liveKernel = kernel
  let lastFallbackCount = 0
  // 已知面句柄集合：getSubShapes(shape,'face') / makeRectangle / makeFace / buildTriFace
  // 返回的面在此登记；extrude/revolveVec 的 face 输入断言、getSubShapes 的
  // edge/vertex 分发都据此判定（brepkit 无 shape-type 分类 API，见下方注释）。
  const knownFaces = new Set<number>()
  const readFallback = (): number => {
    try {
      return typeof kernel.meshFallbackCount === 'function' ? Number(kernel.meshFallbackCount()) : 0
    } catch { return 0 }
  }
  /** 布尔类操作后登记回退计数差（§5.4：宿主每步读取，>0 即链中断）。 */
  const trackFallback = <T>(r: T): T => { lastFallbackCount = readFallback(); return r }

  const faceCenterOfMass = (face: BrepHandle): BrepVec3 => {
    // brepkit 无 per-face 质心 API；用 UV 域中点在曲面上求值作为面中心近似
    // （与 OCCT 路径的「面中心用于命名/拾取锚点」语义一致，不追求精确质心）。
    const d = toNumArray(kernel.getSurfaceDomain(asNum(face)))
    const u = ((d[0] ?? 0) + (d[1] ?? 1)) / 2
    const v = ((d[2] ?? 0) + (d[3] ?? 1)) / 2
    return vec3Of(toNumArray(kernel.evaluateSurface(asNum(face), u, v)))
  }

  const api: BrepkitEngineExtras = {
    // ── 生命周期 ──
    release(_shape: BrepHandle): void { /* GC 型：brepkit 句柄由内核统一管理，无逐句柄 free API */ },
    dispose(_shape?: BrepHandle): void { /* GC 型引擎：无显式释放 */ },
    /** 内核级诊断：距上次读取的 mesh 布尔回退计数差（>0 = BREP 链已中断）。 */
    getMeshFallbackCount(): number {
      const now = readFallback()
      const delta = now - lastFallbackCount
      lastFallbackCount = now
      return delta
    },

    // ── 实体图元 ──
    makeBox(dx: number, dy: number, dz: number): BrepHandle { return asHandle(kernel.makeBox(dx, dy, dz)) },
    makeBoxFromCorners(corner1: BrepVec3, corner2: BrepVec3): BrepHandle {
      const dx = Math.abs(corner2.x - corner1.x), dy = Math.abs(corner2.y - corner1.y), dz = Math.abs(corner2.z - corner1.z)
      const h = kernel.makeBox(dx, dy, dz)
      // ⚠️ transformSolid 是「原地修改、返回 undefined」——makeBox 的句柄本身即新实体，
      // 直接原地变换后返回 h；若写 `asHandle(transformSolid(...))` 会拿到 undefined 句柄
      // （2026-09-25 实证：导致 splitBrep 基于半空间盒的 common/cut 全部失效）。
      kernel.transformSolid(h, toKernelMatrix(translationMatrix(
        Math.min(corner1.x, corner2.x), Math.min(corner1.y, corner2.y), Math.min(corner1.z, corner2.z),
      )))
      return asHandle(h)
    },
    makeCylinder(radius: number, height: number): BrepHandle { return asHandle(kernel.makeCylinder(radius, height)) },
    makeSphere(radius: number): BrepHandle { return asHandle(kernel.makeSphere(radius, 32)) },
    makeCone(r1: number, r2: number, height: number): BrepHandle { return asHandle(kernel.makeCone(r1, r2, height)) },
    makeRectangle(width: number, height: number): BrepHandle {
      const f = kernel.makeRectangle(width, height)
      knownFaces.add(f)
      return asHandle(f)
    },
    makeEllipsoid(rx: number, ry: number, rz: number): BrepHandle { return asHandle(kernel.makeEllipsoid(rx, ry, rz)) },
    makeTorus(majorRadius: number, minorRadius: number): BrepHandle { return asHandle(kernel.makeTorus(majorRadius, minorRadius, 64)) },
    makeVertex(x: number, y: number, z: number): BrepHandle { return asHandle(kernel.makeVertex(x, y, z)) },

    // ── 造型运算 ──
    extrude(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle {
      // 方言归一（§3.6-1）：L1 口径是挤出向量；brepkit 原生吃 (face, dir, distance)。
      const s = asNum(shape)
      if (!knownFaces.has(s)) {
        fail('extrude requires a face input (plan §3.6-1); got a handle that is not a known face')
      }
      const len = Math.hypot(dx, dy, dz)
      if (len === 0) fail('extrude: zero-length extrusion vector')
      return asHandle(kernel.extrude(s, dx / len, dy / len, dz / len, len))
    },
    revolveVec(shape: BrepHandle, center: BrepVec3, direction: BrepVec3, angleDeg: number): BrepHandle {
      // 方言归一：brepkit revolve 只吃 face（与 extrude 同族断言）。
      const s = asNum(shape)
      if (!knownFaces.has(s)) {
        fail('revolveVec requires a face input; got a handle that is not a known face')
      }
      return asHandle(kernel.revolve(
        s, center.x, center.y, center.z, direction.x, direction.y, direction.z, angleDeg,
      ))
    },
    sew(shapesList: BrepHandle[], tolerance?: number): BrepHandle {
      return asHandle(kernel.sewFaces(Uint32Array.from(shapesList.map(asNum)), tolerance ?? 1e-6))
    },
    sewAndSolidify(faces: BrepHandle[], _tolerance?: number): BrepHandle {
      // brepkit 的 makeSolid 即「缝合并固化成实体」（sewFaces + 建 solid）。
      return asHandle(kernel.makeSolid(Uint32Array.from(faces.map(asNum))))
    },
    shell(solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, _tolerance: number): BrepHandle {
      // brepkit 参数序 (solid, thickness, open_faces)；tolerance 内核固定。
      return asHandle(kernel.shell(asNum(solid), thickness, Uint32Array.from(facesToRemove.map(asNum))))
    },
    hullFromPoints(points: BrepVec3[], _tolerance: number): BrepHandle {
      return asHandle(kernel.convexHull(flattenPoints(points)))
    },

    // ── 布尔与分割 ──
    fuse(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(trackFallback(kernel.fuse(asNum(a), asNum(b)))) },
    cut(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(trackFallback(kernel.cut(asNum(a), asNum(b)))) },
    common(a: BrepHandle, b: BrepHandle): BrepHandle {
      // brepkit 无 `common` 原生名；交集语义由 `intersect` 承担（method-map: dialect）。
      return asHandle(trackFallback(kernel.intersect(asNum(a), asNum(b))))
    },
    intersect(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(trackFallback(kernel.intersect(asNum(a), asNum(b)))) },
    fuseAll(shapesList: BrepHandle[]): BrepHandle {
      return asHandle(trackFallback(kernel.fuseAll(Int32Array.from(shapesList.map(asNum)))))
    },
    sectionByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle[] {
      // brepkit 原生 section(solid, plane) 返回剖面 face 句柄组（§3.6-2 新中立名）。
      return arr(kernel.section(
        asNum(shape), point.x, point.y, point.z, normal.x, normal.y, normal.z,
      )).map(asHandle)
    },
    splitByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): { positive: BrepHandle; negative: BrepHandle } {
      const parts = arr(kernel.split(
        asNum(shape), point.x, point.y, point.z, normal.x, normal.y, normal.z,
      ))
      if (parts.length !== 2) {
        fail(`splitByPlane: expected 2 solids, got ${parts.length}`)
      }
      // 法向正侧 = positive（§3.7）：按质心在平面法向的投影分类。
      const originDot = point.x * normal.x + point.y * normal.y + point.z * normal.z
      const side = (h: number): number => {
        const c = toNumArray(kernel.centerOfMass(h, 0.05))
        return (c[0] ?? 0) * normal.x + (c[1] ?? 0) * normal.y + (c[2] ?? 0) * normal.z - originDot
      }
      const [a, b] = parts
      return side(a) >= side(b)
        ? { positive: asHandle(a), negative: asHandle(b) }
        : { positive: asHandle(b), negative: asHandle(a) }
    },

    // ── 倒角与圆角（Q7：只对齐等距 + 距角两种粒度）──
    chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle {
      return asHandle(trackFallback(kernel.chamfer(asNum(solid), Uint32Array.from(edges.map(asNum)), distance)))
    },
    chamferDistAngle(solid: BrepHandle, edges: BrepHandle[], distance: number, angleDeg: number): BrepHandle {
      // 方言映射：L1 chamferDistAngle ↔ brepkit chamferDistanceAngle。
      // ⚠️ 单位方言：L1 口径是**度**（`AddDA(distance, angleDeg, E, F)`），brepkit 内核吃**弧度**
      // （2026-09-25 实证：传 45 抛 "angle must be less than π/2"；传 π/4 正常倒角）。
      const angleRad = (angleDeg * Math.PI) / 180
      return asHandle(trackFallback(kernel.chamferDistanceAngle(
        asNum(solid), Uint32Array.from(edges.map(asNum)), distance, angleRad,
      )))
    },
    fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle {
      return asHandle(trackFallback(kernel.fillet(asNum(solid), Uint32Array.from(edges.map(asNum)), radius)))
    },
    filletVariable(solid: BrepHandle, edge: BrepHandle, startRadius: number, endRadius: number): BrepHandle {
      // 方言映射：L1 filletVariable(solid, edge, startRadius, endRadius)（单边变半径）
      // ↔ brepkit filletVariable(solid, json) 吃**序列** `[{edge, radius1, radius2}, ...]`。
      // ⚠️ 直接传 4 个位置参数会触发 wasm memory out of bounds（2026-09-25 实证）。
      const spec = JSON.stringify([{ edge: asNum(edge), radius1: startRadius, radius2: endRadius }])
      return asHandle(trackFallback(kernel.filletVariable(asNum(solid), spec)))
    },
    filletWithHistory(solid: BrepHandle, edges: BrepHandle[], radius: number, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const raw = kernel.filletWithEvolution(asNum(solid), Int32Array.from(edges.map(asNum)), radius)
      return mapEvolution(kernel, raw, JSON.parse(raw).solid, inputFaceHashes, hashUpperBound)
    },

    // ── 变换 ──
    // ⚠️ brepkit 的 transformSolid 是「原地修改、返回 undefined」——必须先 copySolid
    // 复制出新句柄再变换，否则会篡改调用方手里的原实体（单测 2026-09-19 实证）。
    // ⚠️ 矩阵方言：faijs 接口口径是 3×4 行主序 12 元素（见 brep/engine/primitives.ts）；
    // brepkit transformSolid 吃 4×4 行主序 16 元素。所有 transformSolid 调用一律经
    // toKernelMatrix 归一（下方唯一转换点），禁止直出 16 元素旁路。
    translate(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.transformSolid(c, toKernelMatrix(translationMatrix(dx, dy, dz)))
      return asHandle(c)
    },
    scale(shape: BrepHandle, center: BrepVec3, factor: number): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.transformSolid(c, toKernelMatrix(scaleMatrix(center, factor)))
      return asHandle(c)
    },
    transform(shape: BrepHandle, matrix: number[]): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.transformSolid(c, toKernelMatrix(matrix))
      return asHandle(c)
    },
    located(shape: BrepHandle, matrix: number[]): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.transformSolid(c, toKernelMatrix(matrix))
      return asHandle(c)
    },
    locate(shape: BrepHandle, matrix: number[]): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.transformSolid(c, toKernelMatrix(matrix))
      return asHandle(c)
    },
    generalTransform(shape: BrepHandle, matrix: number[]): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.transformSolid(c, toKernelMatrix(matrix))
      return asHandle(c)
    },
    copy(shape: BrepHandle): BrepHandle { return asHandle(kernel.copySolid(asNum(shape))) },
    copyShape(shape: BrepHandle): BrepHandle { return asHandle(kernel.copySolid(asNum(shape))) },
    composeTransform(m1: number[], m2: number[]): number[] {
      // 方言：L1 是 3×4 行主序 12 元素；brepkit composeTransforms 吃/回 4×4 16 元素。
      const r = kernel.composeTransforms(
        Float64Array.from(toKernelMatrix(m1)),
        Float64Array.from(toKernelMatrix(m2)),
      )
      return Array.from(r as ArrayLike<number>).slice(0, 12)
    },
    mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle {
      return asHandle(kernel.mirror(asNum(shape), point.x, point.y, point.z, normal.x, normal.y, normal.z))
    },

    // ── 阵列 ──
    // brepkit wasm 的 pattern 内核函数都返回 compound（含全部副本）→ 经 getCompoundSolids 拆成数组。
    linearPattern(shape: BrepHandle, direction: BrepVec3, spacing: number, count: number): BrepHandle[] {
      const compound = kernel.linearPattern(asNum(shape), direction.x, direction.y, direction.z, spacing, count)
      return arr(kernel.getCompoundSolids(compound)).map(asHandle)
    },
    circularPattern(shape: BrepHandle, _center: BrepVec3, axis: BrepVec3, _angleStep: number, count: number): BrepHandle[] {
      // ⚠️ brepkit wasm circularPattern(solid, ax, ay, az, count) 无 center/angle 参数：
      // 固定整圆均分（每份 360°/count）。fullAngle=360 时与 vendored/occt 语义一致；
      // 其它角度跨度无法表达（语义限制记录于此，parity 测试用整圆）。
      const compound = kernel.circularPattern(asNum(shape), axis.x, axis.y, axis.z, count)
      return arr(kernel.getCompoundSolids(compound)).map(asHandle)
    },
    gridPattern(shape: BrepHandle, directionX: BrepVec3, directionY: BrepVec3, spacingX: number, spacingY: number, countX: number, countY: number): BrepHandle {
      return asHandle(kernel.gridPattern(
        asNum(shape),
        directionX.x, directionX.y, directionX.z,
        directionY.x, directionY.y, directionY.z,
        spacingX, spacingY, countX, countY,
      ))
    },

    // ── 曲线构造 ──
    makeLineEdge(start: BrepVec3, end: BrepVec3): BrepHandle {
      return asHandle(kernel.makeLineEdge(start.x, start.y, start.z, end.x, end.y, end.z))
    },
    makeArcEdge(start: BrepVec3, mid: BrepVec3, end: BrepVec3): BrepHandle {
      // 方言消化：occt 吃 3 点；brepkit makeCircleArc3d 吃 (start,end,center,axis)。
      const { center, axis } = circumcircle(start, mid, end)
      return asHandle(kernel.makeCircleArc3d(
        start.x, start.y, start.z,
        end.x, end.y, end.z,
        center.x, center.y, center.z,
        axis.x, axis.y, axis.z,
      ))
    },
    makeBezierEdge(controlPoints: BrepVec3[]): BrepHandle {
      // 方言消化：L1 吃控制点（Bezier）；brepkit 原生 makeNurbsEdge 吃
      // (start,end,degree,knots,control_points,weights)。Bezier = degree n-1 的
      // clamped NURBS，knots = [0]×n + [1]×n，weights 全 1。
      const n = controlPoints.length
      if (n < 2) fail('makeBezierEdge: need at least 2 control points')
      const degree = n - 1
      const knots = new Float64Array(2 * n)
      for (let i = n; i < 2 * n; i++) knots[i] = 1
      const weights = new Float64Array(n).fill(1)
      const first = controlPoints[0]
      const last = controlPoints[n - 1]
      return asHandle(kernel.makeNurbsEdge(
        first.x, first.y, first.z,
        last.x, last.y, last.z,
        degree, knots, flattenPoints(controlPoints), weights,
      ))
    },
    makeCircleEdge(center: BrepVec3, normal: BrepVec3, radius: number): BrepHandle {
      return asHandle(kernel.makeCircleEdge(
        center.x, center.y, center.z, normal.x, normal.y, normal.z, radius,
      ))
    },

    // ── 拓扑构造 ──
    makeWire(edges: BrepHandle[]): BrepHandle {
      return asHandle(kernel.makeWire(Int32Array.from(edges.map(asNum)), false))
    },
    makeFace(wire: BrepHandle): BrepHandle {
      const f = kernel.makeFaceFromWire(asNum(wire))
      knownFaces.add(f)
      return asHandle(f)
    },
    makeCompound(shapesList: BrepHandle[]): BrepHandle {
      return asHandle(kernel.makeCompound(Int32Array.from(shapesList.map(asNum))))
    },
    addHolesInFace(face: BrepHandle, holeWires: BrepHandle[]): BrepHandle {
      return asHandle(kernel.addHolesToFace(asNum(face), Int32Array.from(holeWires.map(asNum))))
    },
    buildTriFace(a: BrepVec3, b: BrepVec3, c: BrepVec3): BrepHandle {
      const f = kernel.makePolygon(flattenPoints([a, b, c]))
      knownFaces.add(f)
      return asHandle(f)
    },

    // ── 三角化（BREP→mesh 唯一出口） ──
    meshShape(shape: BrepHandle, options?: BrepTessellateOptions): BrepMeshResult {
      const deflection = options?.linearDeflection ?? 0.1
      const angular = options?.angularDeflection ?? 0.5
      const raw = kernel.tessellateSolidGrouped(asNum(shape), deflection, angular)
      const m = JSON.parse(raw) as { positions: number[]; normals: number[]; indices: number[]; faceOffsets: number[] }
      // faceOffsets 形如 [start0, start1, ..., totalEnd]：以「索引数组单位」计的每面偏移（2026-09-19 实测），
      // 除以 3 换算为 faijs 契约的三角形单位 [triStart, triCount, faceHash]
      const fo = m.faceOffsets
      const faceCount = Math.max(0, fo.length - 1)
      const faceHashes: number[] = []
      try {
        const faces = arr(kernel.getSolidFaces(asNum(shape)))
        for (let i = 0; i < faceCount && i < faces.length; i++) faceHashes.push(faceFingerprint(kernel, faces[i], 1e9))
      } catch { /* 非实体：faceHash 置 0 */ }
      const faceGroups = new Int32Array(faceCount * 3)
      for (let i = 0; i < faceCount; i++) {
        faceGroups[i * 3] = fo[i] / 3
        faceGroups[i * 3 + 1] = (fo[i + 1] - fo[i]) / 3
        faceGroups[i * 3 + 2] = faceHashes[i] ?? 0
      }
      return {
        positions: new Float32Array(m.positions),
        normals: new Float32Array(m.normals),
        indices: new Uint32Array(m.indices),
        vertexCount: m.positions.length / 3,
        triangleCount: m.indices.length / 3,
        faceGroups,
        faceCount,
      }
    },
    wireframe(shape: BrepHandle, deflection?: number): BrepEdgeData {
      const d = deflection ?? 0.1
      // JsEdgeLines：edgeCount/offsets/positions 均为属性（offsets/positions 为 TypedArray，2026-09-19 实测）
      const me = kernel.meshEdgesAll(asNum(shape), d, 0.5) as {
        edgeCount: number; offsets: ArrayLike<number>; positions: ArrayLike<number>
      }
      const edgeCount = Number(me.edgeCount)
      const offsets = arr(me.offsets)
      const positions = arr(me.positions)
      const edgeGroups = new Int32Array(edgeCount * 3)
      for (let i = 0; i < edgeCount; i++) {
        const start = offsets[i] ?? 0
        const count = (offsets[i + 1] ?? positions.length / 3) - start
        edgeGroups[i * 3] = start
        edgeGroups[i * 3 + 1] = count
        edgeGroups[i * 3 + 2] = i // 线框 hash 用序号（wireframe 不参与跨操作溯源）
      }
      return { points: new Float32Array(positions), edgeGroups, pointCount: positions.length, edgeCount }
    },

    // ── 拓扑查询 ──
    // 注意：拓扑 manifest（topologyExt.buildSelectorManifestCore）会在「面句柄」上调用
    // getSubShapes(face, 'edge'/'vertex')，而 brepkit 的 getSolidEdges/getSolidVertices
    // 只接受 solid 句柄；brepkit 提供 getFaceEdges(face)/getFaceVertices(face)。
    // brepkit 没有 shape-type 分类 API，且 getFaceEdges(solid) 不抛错（会返回某一面的边），
    // 不能用 try/catch 探测。改用「已知面集」：每次枚举面时把面句柄记入 knownFaces，
    // edge/vertex 查询时按句柄是否在 knownFaces 里分发到 face 级或 solid 级 API。
    getSubShapes(shape: BrepHandle, type: BrepSubShapeType): BrepHandle[] {
      const s = asNum(shape)
      let list: number[]
      if (type === 'face') {
        // 输入可能是 solid 或 shell
        try { list = arr(kernel.getSolidFaces(s)) }
        catch { list = arr(kernel.getShellFaces?.(s) ?? []) }
        for (const f of list) knownFaces.add(f)
      } else if (type === 'edge') {
        list = knownFaces.has(s)
          ? arr(kernel.getFaceEdges(s))
          : arr(kernel.getSolidEdges(s))
      } else if (type === 'vertex') {
        list = knownFaces.has(s)
          ? arr(kernel.getFaceVertices(s))
          : arr(kernel.getSolidVertices(s))
      } else if (type === 'shell') {
        list = arr(kernel.getSolidShells?.(s) ?? [])
      } else if (type === 'solid') {
        // 输入可能是 compound（多实体）或单个 solid。
        try { list = arr(kernel.getCompoundSolids(s)) }
        catch { list = [s] }
      } else {
        fail(`getSubShapes(${type}): unsupported sub-shape type`)
      }
      return list.map(asHandle)
    },
    subShapeHashes(shape: BrepHandle, type: BrepSubShapeType, hashUpperBound: number): number[] {
      if (type !== 'face') fail(`subShapeHashes(${type}): only 'face' is supported by brepkit`)
      const faces = arr(kernel.getSolidFaces(asNum(shape)))
      const hashes = faces.map(f => faceFingerprint(kernel, f, hashUpperBound))
      // 登记 hash↔handle（fuseWithHistory 溯源对齐依赖此表）
      const reg = hashRegistry.get(kernel) ?? new Map<number, number>()
      faces.forEach((f, i) => reg.set(hashes[i], f))
      hashRegistry.set(kernel, reg)
      return hashes
    },
    hashCode(shape: BrepHandle, upperBound: number): number {
      return faceFingerprint(kernel, asNum(shape), upperBound)
    },
    isSame(a: BrepHandle, b: BrepHandle): boolean { return asNum(a) === asNum(b) },
    isSolid(shape: BrepHandle): boolean {
      try { return arr(kernel.getSolidFaces(asNum(shape))).length > 0 } catch { return false }
    },
    shapeType(shape: BrepHandle): string {
      try {
        const s = arr(kernel.getSolidFaces(asNum(shape)))
        const f = arr(kernel.getFaces(asNum(shape)))
        return s.length > 0 ? 'SOLID' : f.length > 0 ? 'FACE' : 'COMPOUND'
      } catch { return 'COMPOUND' }
    },
    shapeOrientation(shape: BrepHandle): string {
      try { return String(kernel.getShapeOrientation(asNum(shape))) } catch { return 'forward' }
    },
    edgeToFaceMap(shape: BrepHandle): unknown {
      // brepkit 返回 JSON 字符串 {"edgeId":[faceId,...]}；L1 契约是 unknown（调用方自解析）。
      return kernel.edgeToFaceMap(asNum(shape))
    },
    adjacentFaces(shape: BrepHandle, face: BrepHandle): BrepHandle[] {
      return arr(kernel.adjacentFaces(asNum(shape), asNum(face))).map(asHandle)
    },
    sharedEdges(a: BrepHandle, b: BrepHandle): BrepHandle[] {
      return arr(kernel.sharedEdges(asNum(a), asNum(b))).map(asHandle)
    },

    // ── 几何求值 ──
    curveType(edge: BrepHandle): string { return String(kernel.getEdgeCurveType(asNum(edge))) },
    curvePointAtParam(edge: BrepHandle, param: number): BrepVec3 {
      // evaluateEdgeCurve 返回 Float64Array [x,y,z]（非 JSON 字符串）
      return vec3Of(toNumArray(kernel.evaluateEdgeCurve(asNum(edge), param)))
    },
    curveTangent(edge: BrepHandle, param: number): BrepVec3 {
      // evaluateEdgeCurveD1 返回 Float64Array [px,py,pz, tx,ty,tz]（点+切向量）
      const d = toNumArray(kernel.evaluateEdgeCurveD1(asNum(edge), param))
      return { x: d[3] ?? 0, y: d[4] ?? 0, z: d[5] ?? 0 }
    },
    curveParameters(edge: BrepHandle): BrepCurveParameters {
      // getEdgeCurveParameters 返回 Float64Array [first, last]
      const d = toNumArray(kernel.getEdgeCurveParameters(asNum(edge)))
      return { first: d[0] ?? 0, last: d[d.length - 1] ?? 1 }
    },
    curveIsClosed(edge: BrepHandle): boolean {
      // brepkit 无直接 edge-isClosed API；按曲线类型 + Nurbs 元数据判定：
      //   CIRCLE/ELLIPSE 类曲线恒闭合；LINE 恒不闭合；
      //   其他曲线尝试 getNurbsCurveData().closed，拿不到时按不闭合处理（保守，不报错）。
      try {
        const t = String(kernel.getEdgeCurveType(asNum(edge))).toUpperCase()
        if (t === 'CIRCLE' || t === 'ELLIPSE') return true
        if (t === 'LINE') return false
      } catch { /* 类型查询失败走 Nurbs 元数据 */ }
      try {
        const raw = kernel.getNurbsCurveData(asNum(edge))
        if (typeof raw === 'string') {
          const p = JSON.parse(raw) as { closed?: boolean; periodic?: boolean }
          return !!p.closed || !!p.periodic
        }
        if (raw && typeof raw === 'object') {
          const o = raw as Record<string, unknown>
          return !!(o.closed || o.periodic)
        }
      } catch { /* 非 Nurbs 边 */ }
      return false
    },
    curveLength(edge: BrepHandle): number { return Number(kernel.edgeLength(asNum(edge))) },
    surfaceType(face: BrepHandle): string { return String(kernel.getSurfaceType(asNum(face))) },
    surfaceNormal(face: BrepHandle, u: number, v: number): BrepVec3 {
      // evaluateSurfaceNormal(face,u,v) 返回 Float64Array [nx,ny,nz]；
      // 注意：getFaceNormal(face) 只接受 face 一个参数，不带 u/v，不能用于参数空间法向。
      return vec3Of(toNumArray(kernel.evaluateSurfaceNormal(asNum(face), u, v)))
    },
    pointOnSurface(face: BrepHandle, u: number, v: number): BrepVec3 {
      // evaluateSurface 返回 Float64Array [x,y,z]
      return vec3Of(toNumArray(kernel.evaluateSurface(asNum(face), u, v)))
    },
    uvBounds(face: BrepHandle): BrepUvBounds {
      // getSurfaceDomain 返回 Float64Array [uMin,uMax,vMin,vMax]
      const d = toNumArray(kernel.getSurfaceDomain(asNum(face)))
      return { uMin: d[0] ?? 0, uMax: d[1] ?? 1, vMin: d[2] ?? 0, vMax: d[3] ?? 1 }
    },
    surfaceCenterOfMass: faceCenterOfMass,
    getFaceCylinderData(face: BrepHandle): { radius: number } | null {
      try {
        const p = JSON.parse(kernel.getAnalyticSurfaceParams(asNum(face))) as { type?: string; radius?: number }
        if (p?.type === 'cylinder' && typeof p.radius === 'number') return { radius: p.radius }
      } catch { /* 非解析面 */ }
      return null
    },
    getNurbsCurveData(edge: BrepHandle): { degree: number; periodic: boolean; rational: boolean } | null {
      try {
        const p = JSON.parse(kernel.getNurbsCurveData(asNum(edge))) as { degree?: number; periodic?: boolean; rational?: boolean }
        if (p && typeof p.degree === 'number') return { degree: p.degree, periodic: !!p.periodic, rational: !!p.rational }
      } catch { /* 非 Nurbs 边 */ }
      return null
    },
    interpolatePoints(points: BrepVec3[], degree: number): BrepHandle {
      return asHandle(kernel.interpolatePoints(flattenPoints(points), degree))
    },
    defeature(shape: BrepHandle, faces: BrepHandle[]): BrepHandle {
      return asHandle(kernel.defeature(asNum(shape), Uint32Array.from(faces.map(asNum))))
    },
    draft(shape: BrepHandle, faces: BrepHandle[], pull: BrepVec3, neutral: BrepVec3, angleDeg: number): BrepHandle {
      return asHandle(kernel.draft(
        asNum(shape),
        Uint32Array.from(faces.map(asNum)),
        pull.x, pull.y, pull.z,
        neutral.x, neutral.y, neutral.z,
        angleDeg,
      ))
    },
    removeHolesFromFace(face: BrepHandle): BrepHandle {
      return asHandle(kernel.removeHolesFromFace(asNum(face)))
    },
    reverseShape(shape: BrepHandle): BrepHandle {
      return asHandle(kernel.reverseShape(asNum(shape)))
    },
    projectEdges(shape: BrepHandle, origin: BrepVec3, direction: BrepVec3, xAxis: BrepVec3, hiddenLines: boolean, deflection: number): unknown {
      // brepkit 返回 JSON 字符串 {"visible":[[x,y,…]],"hidden":[[…]]}；L1 契约是 unknown。
      return kernel.projectEdges(
        asNum(shape),
        origin.x, origin.y, origin.z,
        direction.x, direction.y, direction.z,
        xAxis.x, xAxis.y, xAxis.z,
        hiddenLines, deflection,
      )
    },

    // ── 测量 ──
    getBoundingBox(shape: BrepHandle, _useTriangulation?: boolean): BrepBoundingBox {
      const b = kernel.boundingBox(asNum(shape)) as ArrayLike<number>
      return { xmin: b[0], ymin: b[1], zmin: b[2], xmax: b[3], ymax: b[4], zmax: b[5] }
    },
    getVolume(shape: BrepHandle): number { return Number(kernel.volume(asNum(shape), 0.05)) },
    getCenterOfMass(shape: BrepHandle): BrepVec3 {
      // centerOfMass 返回 Float64Array [x,y,z]（非 JSON 字符串）
      return vec3Of(toNumArray(kernel.centerOfMass(asNum(shape), 0.05)))
    },
    getSurfaceArea(shape: BrepHandle): number {
      // 方言映射：L1 getSurfaceArea ↔ brepkit surfaceArea(solid, deflection)。
      return Number(kernel.surfaceArea(asNum(shape), 0.05))
    },
    getLength(shape: BrepHandle): number {
      // 方言映射：L1 getLength ↔ brepkit edgeLength(edge) / wireLength(wire)。
      // wire 与 edge 的入参差异在适配器内判别（D6）：edgeLength 只吃 edge 句柄，
      // 对 wire 会抛错；据此分发，两条路径都失败时如实抛出（不静默返回 0）。
      const s = asNum(shape)
      try {
        kernel.getEdgeCurveType(s)
        return Number(kernel.edgeLength(s))
      } catch {
        return Number(kernel.wireLength(s))
      }
    },

    // ── 校验与修复 ──
    // ⚠️ brepkit 的修复类内核函数全部是「**原地修改入参实体 + 返回修复计数**」，不是返回新句柄：
    //   healSolid(solid)             → 修复的问题数
    //   fixFaceOrientations(solid)   → 修复的面数
    //   unifyFaces(solid)            → 合并删除的面数
    //   removeDegenerateEdges(s,tol) → 删除的边数
    //   repairSolid(solid)           → 修复后剩余错误数
    // 直接 `asHandle(kernel.healSolid(...))` 会把计数（常见为 0）当成句柄，得到无效实体
    // （2026-09-25 实证）。正确适配：先 copySolid 保护调用方原实体，再原地修复副本，返回副本句柄。
    isValid(shape: BrepHandle): boolean {
      // brepkit validateSolid 返回错误数（0 = 有效）。
      return Number(kernel.validateSolid(asNum(shape))) === 0
    },
    unifySameDomain(shape: BrepHandle): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.unifyFaces(c)
      return asHandle(c)
    },
    healSolid(shape: BrepHandle, _tolerance?: number): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.healSolid(c)
      return asHandle(c)
    },
    fixShape(shape: BrepHandle): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.healSolid(c)
      return asHandle(c)
    },
    fixFaceOrientations(shape: BrepHandle): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.fixFaceOrientations(c)
      return asHandle(c)
    },
    removeDegenerateEdges(shape: BrepHandle, tolerance?: number): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.removeDegenerateEdges(c, tolerance ?? 1e-6)
      return asHandle(c)
    },

    // ── IO ──
    importStep(data: string | ArrayBuffer): BrepHandle {
      // ⚠️ brepkit importStep 吃 **Uint8Array**（不是字符串），返回 **Uint32Array**（文件内可含多个 solid）。
      // L1 契约是单 BrepHandle：0 个 → fail；1 个 → 直通；多个 → 合成 compound（2026-09-25 实证）。
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
      const solids = arr(kernel.importStep(bytes))
      if (solids.length === 0) fail('importStep: kernel returned no solid')
      return asHandle(solids.length === 1 ? solids[0] : kernel.makeCompound(Uint32Array.from(solids)))
    },
    exportStep(shape: BrepHandle): string {
      // brepkit exportStep 返回 UTF-8 字节（Uint8Array），需解码为 STEP 文本（2026-09-19 实测）
      const bytes = kernel.exportStep(asNum(shape))
      return typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)
    },
    importStl(data: string | ArrayBuffer): BrepHandle {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
      return asHandle(kernel.importStl(bytes))
    },
    fromBREP(data: string): BrepHandle {
      // ⚠️ brepkit fromBREP 吃字符串（STEP 文本或 toBREP/toBrepJson 输出，内核自动判别），
      // 与 serializeSolid/deserializeSolid 的**二进制 arena** 是两套机制。
      // 旧实现误用 `deserializeSolid(atob(data))`：base64 解码破坏了 STEP 文本 → 往返必失败
      // （2026-09-25 实证：fromBREP(STEP)、fromBREP(toBREP)、fromBREP(toBrepJson) 均成功）。
      return asHandle(kernel.fromBREP(data))
    },

    // ── 面演化（L1 三员 + filletWithHistory，双方都有对齐实现） ──
    cutWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const raw = kernel.cutWithEvolution(asNum(a), asNum(b))
      return mapEvolution(kernel, raw, JSON.parse(raw).solid, inputFaceHashes, hashUpperBound)
    },
    fuseWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const raw = kernel.fuseWithEvolution(asNum(a), asNum(b))
      return mapEvolution(kernel, raw, JSON.parse(raw).solid, inputFaceHashes, hashUpperBound)
    },
    intersectWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const raw = kernel.intersectWithEvolution(asNum(a), asNum(b))
      return mapEvolution(kernel, raw, JSON.parse(raw).solid, inputFaceHashes, hashUpperBound)
    },
  }
  return api
}

// ── 工具 ──

/** 3×4 行主序平移矩阵（faijs 接口方言：平移在 index 3/7/11，与 matrixToArray 同构）。 */
function translationMatrix(dx: number, dy: number, dz: number): number[] {
  return [
    1, 0, 0, dx,
    0, 1, 0, dy,
    0, 0, 1, dz,
  ]
}

/** 3×4 行主序缩放矩阵（绕 center 缩放；faijs 接口方言，12 元素）。 */
function scaleMatrix(center: BrepVec3, factor: number): number[] {
  return [
    factor, 0, 0, center.x * (1 - factor),
    0, factor, 0, center.y * (1 - factor),
    0, 0, factor, center.z * (1 - factor),
  ]
}

/**
 * 唯一的矩阵方言转换点：faijs 3×4 行主序（12 元素，matrixToArray 口径）→
 * brepkit transformSolid 的 4×4 行主序（16 元素，补底行 0,0,0,1）。
 * translate/scale 内部矩阵与 transform/located/generalTransform 的宿主入参
 * 全部经此归一；非 12 元素直接抛错（方言不清 = 缺陷，静默通过即红线违规）。
 */
function toKernelMatrix(matrix: number[]): number[] {
  if (matrix.length !== 12) {
    throw new Error(
      `[brepkit] matrix dialect violation: expected 12 elements (3x4 row-major, faijs interface contract), got ${matrix.length}`,
    )
  }
  return [
    matrix[0], matrix[1], matrix[2], matrix[3],
    matrix[4], matrix[5], matrix[6], matrix[7],
    matrix[8], matrix[9], matrix[10], matrix[11],
    0, 0, 0, 1,
  ]
}

/** wasm 返回的点/向量形态归一（数组 [x,y,z] 或 {x,y,z}）。 */
function vec3Of(p: number[] | { x: number; y: number; z: number }): BrepVec3 {
  if (Array.isArray(p)) return { x: p[0], y: p[1], z: p[2] }
  return { x: Number(p.x), y: Number(p.y), z: Number(p.z) }
}


/** 已初始化的 brepkit 内核单例（createBrepkitPrimitives 时赋值）。 */
let liveKernel: BrepKitKernel | null = null

/**
 * 原生 brepkit 内核面（D3）：平台特定代码访问 brepkit 独有能力的唯一入口
 * （chamfer2d/chamferV2/filletV2/sketch* 族、serializeSolid、meshBoolean 等）。
 *
 * ⚠️ 这是**平台特定**出口——import 本函数即声明「这段代码只跑在 brepkit 引擎下」。
 * 可移植代码请用 `getBrepApi()`（L1 契约面）。
 *
 * @returns the live brepkit wasm kernel singleton.
 */
export function getBrepkitKernel(): BrepKitKernel {
  if (!liveKernel) {
    throw new Error('[brepkit-kernel] kernel not initialized: call createBrepkitPrimitives() first')
  }
  return liveKernel
}

/** 释放内核单例（测试收尾用；宿主常驻不需调用）。 */
export function disposeBrepkit(): void {
  try {
    if (liveKernel?.free) liveKernel.free()
  } catch { /* 已释放 */ }
  liveKernel = null
}

/** brepkit 适配器原语集类型（BrepEngineApi + brepkit 专属诊断 getMeshFallbackCount）。 */
export type BrepkitPrimitives = Awaited<ReturnType<typeof createBrepkitPrimitives>>
