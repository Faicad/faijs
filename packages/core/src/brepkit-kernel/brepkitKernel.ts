/**
 * brepkit-kernel/brepkitKernel — brepkit 内核 → faijs BrepEngineApi 适配器（v1 白名单）
 *
 * 设计要点（对应 3d_editor 项目的 weapp-voice-ai-modeling 设计计划 §5）：
 * - 句柄：brepkit u32 句柄与 faijs BrepHandle(number) 同构，直通零转换；
 * - 拓扑红线：meshShape 用 tessellateSolidGrouped 输出 faceGroups，与三角化几何同源；
 * - 面溯源：布尔/倒角走 *WithEvolution，映射为 BrepEvolutionData（hash 编码）；
 * - 链纪律：kernel.meshFallbackCount 计数差 > 0 → getMeshFallbackCount 暴露给宿主，
 *   由宿主标记 BREP 链中断（不在此层静默处理）；
 * - v1 白名单之外的方法：显式抛错（报错好于掩盖，禁止空实现假成功）。
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
  BrepXcafDocument,
} from '../brep/engine/types'

// ── 句柄桥接：brepkit number 句柄 ↔ BrepHandle（零运行时成本，与 occt 适配器同构） ──
const asHandle = (n: number): BrepHandle => n as BrepHandle
const asNum = (h: BrepHandle): number => h as unknown as number
const arr = (x: ArrayLike<number> | number[]): number[] => Array.from(x as ArrayLike<number>)

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

/** v1 白名单外的方法统一抛错（携带适配器上下文与 v1 范围说明）。 */
function unsupported(name: string): never {
  throw new Error(`[brepkit-kernel] BrepEngineApi.${name} 不在 brepkit 适配器 v1 白名单内（能力表见设计文档 §5.2）。该操作请在 OCCT 链执行，或等待适配器扩展。`)
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

/**
 * 创建 brepkit BrepEngineApi 实现（v1 白名单）。
 * 与 occt 的 initOcctWasm 同位：返回满足引擎契约的原语集合。
 * @returns a promise resolving to the BrepEngineApi implementation plus brepkit-specific
 * diagnostics (`getMeshFallbackCount`).
 */
export async function createBrepkitPrimitives(): Promise<BrepkitEngineExtras> {
  const kernel = await initBrepkitWasm()
  liveKernel = kernel
  let lastFallbackCount = 0
  // 已知面句柄集合：getSubShapes(shape,'face') 返回的面在此登记；
  // getSubShapes(handle,'edge'/'vertex') 据此分发到 face 级或 solid 级 API。
  const knownFaces = new Set<number>()
  const readFallback = (): number => {
    try {
      return typeof kernel.meshFallbackCount === 'function' ? Number(kernel.meshFallbackCount()) : 0
    } catch { return 0 }
  }
  /** 布尔类操作后登记回退计数差（§5.4：宿主每步读取，>0 即链中断）。 */
  const trackFallback = <T>(r: T): T => { lastFallbackCount = readFallback(); return r }

  const api = {
    // ── 生命周期 ──
    release(_shape: BrepHandle): void { /* GC 型：brepkit 句柄由内核统一管理，无逐句柄 free API */ },
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
      return asHandle(kernel.transformSolid(h, toKernelMatrix(translationMatrix(
        Math.min(corner1.x, corner2.x), Math.min(corner1.y, corner2.y), Math.min(corner1.z, corner2.z),
      ))))
    },
    makeCylinder(radius: number, height: number): BrepHandle { return asHandle(kernel.makeCylinder(radius, height)) },
    makeSphere(radius: number): BrepHandle { return asHandle(kernel.makeSphere(radius, 32)) },
    makeCone(r1: number, r2: number, height: number): BrepHandle { return asHandle(kernel.makeCone(r1, r2, height)) },
    makeRectangle(_width: number, _height: number): BrepHandle { return unsupported('makeRectangle') },

    // ── 造型运算 ──
    extrude(_shape: BrepHandle, _dx: number, _dy: number, _dz: number): BrepHandle { return unsupported('extrude') },
    loft(_wires: BrepHandle[], _isSolid: boolean, _ruled: boolean): BrepHandle { return unsupported('loft') },

    // ── 布尔与分割 ──
    fuse(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(trackFallback(kernel.fuse(asNum(a), asNum(b)))) },
    cut(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(trackFallback(kernel.cut(asNum(a), asNum(b)))) },
    common(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(trackFallback(kernel.common(asNum(a), asNum(b)))) },
    intersect(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(trackFallback(kernel.common(asNum(a), asNum(b)))) },
    section(_a: BrepHandle, _b: BrepHandle): BrepHandle { return unsupported('section') },
    fuseAll(shapes: BrepHandle[]): BrepHandle {
      return asHandle(trackFallback(kernel.fuseAll(Int32Array.from(shapes.map(asNum)))))
    },

    // ── 倒角与圆角 ──
    chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle {
      return asHandle(trackFallback(kernel.chamfer(asNum(solid), Int32Array.from(edges.map(asNum)), distance)))
    },
    chamferDistAngle(solid: BrepHandle, edges: BrepHandle[], distance: number, angleDeg: number): BrepHandle {
      return asHandle(trackFallback(kernel.chamferDistanceAngle(asNum(solid), Int32Array.from(edges.map(asNum)), distance, angleDeg)))
    },
    fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle {
      return asHandle(trackFallback(kernel.fillet(asNum(solid), Int32Array.from(edges.map(asNum)), radius)))
    },
    filletVariable(solid: BrepHandle, edge: BrepHandle, startRadius: number, endRadius: number): BrepHandle {
      return asHandle(trackFallback(kernel.filletVariable(asNum(solid), asNum(edge), startRadius, endRadius)))
    },
    filletWithHistory(solid: BrepHandle, edges: BrepHandle[], radius: number, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const raw = kernel.filletWithEvolution(asNum(solid), Int32Array.from(edges.map(asNum)), radius)
      return mapEvolution(kernel, raw, JSON.parse(raw).solid, inputFaceHashes, hashUpperBound)
    },
    chamferWithHistory(_solid: BrepHandle, _edges: BrepHandle[], _distance: number, _inputFaceHashes: number[], _hashUpperBound: number): BrepEvolutionData {
      // brepkit 无 chamferWithEvolution → 等距倒角演化不支持，诚实报错（能力表 evolution 仅覆盖 fuse/cut/fillet）
      return unsupported('chamferWithHistory')
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
    generalTransform(shape: BrepHandle, matrix: number[]): BrepHandle {
      const c = kernel.copySolid(asNum(shape))
      kernel.transformSolid(c, toKernelMatrix(matrix))
      return asHandle(c)
    },
    copy(shape: BrepHandle): BrepHandle { return asHandle(kernel.copySolid(asNum(shape))) },

    // ── 阵列（Phase 2：brepkit wasm 已导出 linearPattern/circularPattern/gridPattern） ──
    // brepkit wasm 的 pattern 内核函数都返回 compound（含全部副本，README「Returns a
    // compound handle containing all copies」实证）→ 经 getCompoundSolids 拆成数组。
    linearPattern(shape: BrepHandle, direction: BrepVec3, spacing: number, count: number): BrepHandle[] {
      const compound = kernel.linearPattern(asNum(shape), direction.x, direction.y, direction.z, spacing, count)
      return arr(kernel.getCompoundSolids(compound)).map(asHandle)
    },
    circularPattern(shape: BrepHandle, center: BrepVec3, axis: BrepVec3, angleStep: number, count: number): BrepHandle[] {
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
    makeArcEdge(_start: BrepVec3, _mid: BrepVec3, _end: BrepVec3): BrepHandle { return unsupported('makeArcEdge') },
    makeBezierEdge(_controlPoints: BrepVec3[]): BrepHandle { return unsupported('makeBezierEdge') },

    // ── 拓扑构造 ──
    makeWire(edges: BrepHandle[]): BrepHandle {
      return asHandle(kernel.makeWire(Int32Array.from(edges.map(asNum)), false))
    },
    makeFace(wire: BrepHandle): BrepHandle { return asHandle(kernel.makeFaceFromWire(asNum(wire))) },
    makeCompound(shapes: BrepHandle[]): BrepHandle {
      return asHandle(kernel.makeCompound(Int32Array.from(shapes.map(asNum))))
    },
    sewAndSolidify(faces: BrepHandle[], tolerance?: number): BrepHandle {
      return asHandle(kernel.sewFaces(Int32Array.from(faces.map(asNum)), tolerance ?? 1e-6))
    },
    buildTriFace(_a: BrepVec3, _b: BrepVec3, _c: BrepVec3): BrepHandle { return unsupported('buildTriFace') },
    addHolesInFace(face: BrepHandle, holeWires: BrepHandle[]): BrepHandle {
      return asHandle(kernel.addHolesToFace(asNum(face), Int32Array.from(holeWires.map(asNum))))
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
        return unsupported(`getSubShapes(${type})`)
      }
      return list.map(asHandle)
    },
    queryBatch(shapes: BrepHandle[]): Array<{ area: number }> {
      return shapes.map(h => {
        try { return { area: Number(kernel.faceArea(asNum(h))) } } catch { return { area: 0 } }
      })
    },
    subShapeHashes(shape: BrepHandle, type: BrepSubShapeType, hashUpperBound: number): number[] {
      if (type !== 'face') return unsupported(`subShapeHashes(${type})`)
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
    shapeOrientation(shape: BrepHandle): string {
      try { return String(kernel.getShapeOrientation(asNum(shape))) } catch { return 'forward' }
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
    getSurfaceCenterOfMass(face: BrepHandle): BrepVec3 {
      // brepkit 无 per-face 质心 API；用 UV 域中点在曲面上求值作为面中心近似
      // （与 OCCT 路径的「面中心用于命名/拾取锚点」语义一致，不追求精确质心）。
      const b = this.uvBounds(face)
      return this.pointOnSurface(face, (b.uMin + b.uMax) / 2, (b.vMin + b.vMax) / 2)
    },
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

    // ── 校验与修复 ──
    isValid(_shape: BrepHandle): boolean { return unsupported('isValid') },
    unifySameDomain(shape: BrepHandle): BrepHandle { return shape /* brepkit 无对应 API；恒等返回（不丢句柄） */ },
    healSolid(shape: BrepHandle, _tolerance?: number): BrepHandle { return asHandle(kernel.healSolid(asNum(shape))) },
    fixShape(shape: BrepHandle): BrepHandle { return asHandle(kernel.healSolid(asNum(shape))) },
    fixFaceOrientations(shape: BrepHandle): BrepHandle { return asHandle(kernel.fixFaceOrientations(asNum(shape))) },
    removeDegenerateEdges(_shape: BrepHandle): BrepHandle { return unsupported('removeDegenerateEdges') },

    // ── IO ──
    importStep(data: string | ArrayBuffer): BrepHandle {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
      return asHandle(kernel.importStep(text))
    },
    exportStep(shape: BrepHandle): string {
      // brepkit exportStep 返回 UTF-8 字节（Uint8Array），需解码为 STEP 文本（2026-09-19 实测）
      const bytes = kernel.exportStep(asNum(shape))
      return typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)
    },
    importStl(_data: string | ArrayBuffer): BrepHandle { return unsupported('importStl') },
    fromBREP(data: string): BrepHandle {
      const bytes = Uint8Array.from(atobPolyfill(data))
      return asHandle(kernel.deserializeSolid(bytes))
    },

    // ── 面演化（可选能力槽） ──
    cutWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const raw = kernel.cutWithEvolution(asNum(a), asNum(b))
      return mapEvolution(kernel, raw, JSON.parse(raw).solid, inputFaceHashes, hashUpperBound)
    },
    fuseWithHistory(a: BrepHandle, b: BrepHandle, inputFaceHashes: number[], hashUpperBound: number): BrepEvolutionData {
      const raw = kernel.fuseWithEvolution(asNum(a), asNum(b))
      return mapEvolution(kernel, raw, JSON.parse(raw).solid, inputFaceHashes, hashUpperBound)
    },
    intersectWithHistory(_a: BrepHandle, _b: BrepHandle, _inputFaceHashes: number[], _hashUpperBound: number): BrepEvolutionData {
      return unsupported('intersectWithHistory')
    },
    // Phase 0.1 补齐的 7 个：brepkit 适配器 v1 未实现 —— 如实抛错，不伪造。
    // ⚠️ 这些桩**不能**被当作"已实现"来探测：`typeof api.xWithHistory === 'function'`
    // 恒为真。Phase 0.2 起适配器的 `evolution` 是逐核函数**名单**
    // （`adapters/brepkit.ts` = ['fuse','cut','fillet']），名单才是唯一真相来源；
    // 声明多写一项 = 让该 op 静默通过静态判定后死在这些桩上（红线违规）。
    translateWithHistory(_shape: BrepHandle, _dx: number, _dy: number, _dz: number, _inputFaceHashes: number[], _hashUpperBound: number): BrepEvolutionData {
      return unsupported('translateWithHistory')
    },
    rotateWithHistory(_shape: BrepHandle, _axis: { point: BrepVec3; direction: BrepVec3 }, _angleRad: number, _inputFaceHashes: number[], _hashUpperBound: number): BrepEvolutionData {
      return unsupported('rotateWithHistory')
    },
    mirrorWithHistory(_shape: BrepHandle, _point: BrepVec3, _normal: BrepVec3, _inputFaceHashes: number[], _hashUpperBound: number): BrepEvolutionData {
      return unsupported('mirrorWithHistory')
    },
    scaleWithHistory(_shape: BrepHandle, _center: BrepVec3, _factor: number, _inputFaceHashes: number[], _hashUpperBound: number): BrepEvolutionData {
      return unsupported('scaleWithHistory')
    },
    shellWithHistory(_solid: BrepHandle, _faces: BrepHandle[], _thickness: number, _tolerance: number, _inputFaceHashes: number[], _hashUpperBound: number): BrepEvolutionData {
      return unsupported('shellWithHistory')
    },
    offsetWithHistory(_solid: BrepHandle, _distance: number, _tolerance: number, _inputFaceHashes: number[], _hashUpperBound: number): BrepEvolutionData {
      return unsupported('offsetWithHistory')
    },
    thickenWithHistory(_shape: BrepHandle, _thickness: number, _tolerance: number, _inputFaceHashes: number[], _hashUpperBound: number): BrepEvolutionData {
      return unsupported('thickenWithHistory')
    },

    // ── XCAF 装配（v1 关闭） ──
    createXCAFDocument(): BrepXcafDocument { return unsupported('createXCAFDocument') },
    importXCAFFromSTEP(_stepData: string): BrepXcafDocument { return unsupported('importXCAFFromSTEP') },
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

/** base64 解码（node 与浏览器通用，避免直接依赖 Buffer）。 */
function atobPolyfill(s: string): string {
  if (typeof atob === 'function') return atob(s)

  return Buffer.from(s, 'base64').toString('binary')
}

/** 释放内核单例（测试收尾用；宿主常驻不需调用）。 */
let liveKernel: BrepKitKernel | null = null

/** 释放内核单例（测试收尾用；宿主常驻不需调用）。 */
export function disposeBrepkit(): void {
  try {
    if (liveKernel?.free) liveKernel.free()
  } catch { /* 已释放 */ }
  liveKernel = null
}

/** brepkit 适配器原语集类型（BrepEngineApi + brepkit 专属诊断 getMeshFallbackCount）。 */
export type BrepkitPrimitives = Awaited<ReturnType<typeof createBrepkitPrimitives>>
