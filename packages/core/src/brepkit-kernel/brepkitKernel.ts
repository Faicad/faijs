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

import { initBrepkitWasm, resetBrepkitWasm, type BrepKitKernel } from './brepkitWasm'
import { DEFAULT_LINEAR_DEFLECTION } from '../tolerance'
import { mm } from '../units'
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

// ── 句柄桥接：brepkit number 句柄 ↔ BrepHandle ──
//
// GOTCHA（2026-10-01 实测，本文件最容易踩的坑）：brepkit 句柄是**按类型分命名空间的裸 u32**
// ——同一个 box 上 solid=0、face=0..5、edge=0..11 同时存在，且**内核没有任何可靠的类型判别式**：
//   getEdgeCurveType(0) / edgeLength(0)     → 命中 edge 0
//   getFaceEdges(0) / getFaceNormal(0)      → 命中 face 0
//   getSolidFaces(0)                        → 命中 solid 0
// 三者对同一个数字 0 各自返回「自己命名空间里 0 号」的数据，谁都不抛错（`getSolidFaces(1)` 才抛）。
// 因此「拿句柄去问内核它是什么类型」在 brepkit 上**不可能实现**。
//
// 但 L1 契约里 `hashCode(handle)` 只收到一个数字，必须知道类型才能选面/边指纹函数。
// 解法：适配器在**出口**把类型编进句柄高位。类型随句柄流动，`asNum()` 剥掉标签后仍是内核
// 裸句柄号——内部集合（knownFaces/knownEdges/…）、hashRegistry、全部 `kernel.*` 调用语义不变。
// 高 3 位（bit 26..28）放类型；虚拟 compound 句柄从 bit 29（0x20000000）起分配，互不干扰。
// 注意 `asNum` 用**算术减法**而非 `& ~KIND_MASK`：后者把 ≥2^31 的虚拟句柄按 int32 截断成负数。
const KIND_SHIFT = 26
const KIND_MASK = 7 << KIND_SHIFT
const KIND_SOLID = 0 << KIND_SHIFT      // 也是 compound / 未登记句柄的默认类
const KIND_FACE = 1 << KIND_SHIFT
const KIND_EDGE = 2 << KIND_SHIFT
const KIND_WIRE = 3 << KIND_SHIFT
const KIND_VERTEX = 4 << KIND_SHIFT

/** 句柄类型标签（0 = SOLID/COMPOUND 默认类）。 */
const kindOf = (h: BrepHandle): number => (h as unknown as number) & KIND_MASK
/** 剥掉类型标签，得到 brepkit 内核裸句柄号——所有 `kernel.*` 调用必须用这个。 */
const asNum = (h: BrepHandle): number => {
  const n = h as unknown as number
  return n - (n & KIND_MASK)
}
/** 实体/compound 句柄（默认类，保持历史行为：无标签 ⇒ 内核按 solid 路径分发）。 */
const asHandle = (n: number): BrepHandle => n as BrepHandle
const asFace = (n: number): BrepHandle => (n | KIND_FACE) as BrepHandle
const asEdge = (n: number): BrepHandle => (n | KIND_EDGE) as BrepHandle
const asWire = (n: number): BrepHandle => (n | KIND_WIRE) as BrepHandle
const asVertex = (n: number): BrepHandle => (n | KIND_VERTEX) as BrepHandle
/** 按已有类型标签给裸句柄重新打标签（copy/transform 族保持入参类型）。 */
const withKind = (kind: number, n: number): BrepHandle => {
  switch (kind) {
    case KIND_FACE: return asFace(n)
    case KIND_EDGE: return asEdge(n)
    case KIND_WIRE: return asWire(n)
    case KIND_VERTEX: return asVertex(n)
    default: return asHandle(n)
  }
}
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

/**
 * brepkit 无任何 hash API（228 个方法里没有 hashCode/subShapeHashes）——faijs 侧的
 * 面/边 hash 全部由适配器**合成指纹**，因此「合成函数」与「消费函数的取模上界」
 * 必须同源：
 * - 消费端 `topologyExt.buildSelectorManifestCore` 用
 *   `kernel.hashCode(subShape, BREP_HASH_BOUND)` 回查 faceGroups/edgeGroups 里的 hash；
 * - 生产端（本文件的 solidMesh / faceMesh / compoundMesh / wireframe）必须用**同一个**
 *   `BREP_HASH_BOUND` 生成，否则查表恒 miss。
 *
 * GOTCHA（2026-10-01 实测修复）：本文件此前生产端用 1e9、消费端用 2147483647，
 * 导致 brepkit 引擎下面行的 triStart/triCount 恒为 0（面积/法向随之丢失）。
 */
function fnv1a(basis: string, upperBound: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return upperBound > 0 ? h % upperBound : h
}

/** 面稳定指纹：解析曲面参数 + 面积 → FNV-1a → 取模上界（跨操作可追溯，与句柄无关）。 */
function faceFingerprint(kernel: BrepKitKernel, face: number, upperBound: number): number {
  let params = ''
  try { params = String(kernel.getAnalyticSurfaceParams(face) ?? '') } catch { /* 非解析面 */ }
  let area = 0
  try { area = Number(kernel.faceArea?.(face, 0.1) ?? 0) } catch { /* 查询失败用 0 */ }
  return fnv1a(`${params}|${area.toFixed(6)}`, upperBound)
}

/**
 * 边稳定指纹：曲线类型 + 参数区间 + 两端/中点采样 + 长度 → FNV-1a。
 *
 * 为什么不能用 `faceFingerprint`：它对边恒得同一个值（`getAnalyticSurfaceParams`
 * 与 `faceArea` 对 edge 句柄都抛错）——旧实现在 box 上 12 条边 hash 全同，
 * 使 `topologyExt` 的 edgeGroupByHash 只留最后一条折线（实测 2026-10-01）。
 *
 * 为什么不能只用端点：整圆（圆柱端盖）首末点重合，z 不同的两个圆会撞 —
 * 故补 UV 中点采样。`getBoundingBox(edge)` 在 brepkit 上抛错，不可用。
 */
function edgeFingerprint(kernel: BrepKitKernel, edge: number, upperBound: number): number {
  let curveType = ''
  try { curveType = String(kernel.getEdgeCurveType(edge) ?? '') } catch { /* 非边 */ }
  let range = ''
  let mid = ''
  try {
    // 方言：`getEdgeCurveParameters` 返回 **Float64Array**（如 [0, 10]），不是 JSON 字符串
    // （见本文件头的返回值归一化说明）。曾误用 JSON.parse → 恒定抛错 → range/mid 恒空，
    // 于是所有同类型同长度的边（box 的 12 条棱）挤成同一个指纹（2026-10-01 实测）。
    const p = toNumArray(kernel.getEdgeCurveParameters(edge))
    const first = p[0] ?? 0
    const last = p[1] ?? 0
    range = `${first.toFixed(9)},${last.toFixed(9)}`
    const midT = (first + last) / 2
    const sample = (t: number): string => toNumArray(kernel.evaluateEdgeCurve(edge, t)).map((x) => x.toFixed(6)).join(',')
    mid = `${sample(first)}|${sample(midT)}|${sample(last)}`
  } catch { /* 采样失败 → 退化为类型 + 空几何 */ }
  let length = 0
  try { length = Number(kernel.edgeLength(edge) ?? 0) } catch { /* 长度不可用用 0 */ }
  return fnv1a(`${curveType}|${range}|${mid}|${length.toFixed(6)}`, upperBound)
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
  const deletedKeys = new Set((evo.deleted ?? []).map(Number))
  // registry 登记的是 hash→handle（输入面）。下游 decodeEvolution/decodeHashEvolution 期望
  // modified 为 OCCT 分段格式 [inHash, count, outHash1, outHash2, ...]（见 face-evolution.ts），
  // 不是扁平 hash 列表——GOTCHA：曾误返回扁平列表，把 modified[1]（一个 hash ~1e9）当成
  // count，导致 decodeHashEvolution 空转 17 亿次 push 抛 "Invalid array length"（2026-09-26 实证）。
  // 故这里反向建 handle→hash 表，逐条目拼出 [inHash, outCount, ...outHashes]。
  const registry = hashRegistry.get(kernel)
  const handleToHash = new Map<number, number>()
  if (registry) for (const [h, handle] of registry) handleToHash.set(handle, h)
  const modified: number[] = []
  const deleted: number[] = []
  for (const oldHandle of deletedKeys) {
    const h = handleToHash.get(oldHandle)
    if (h !== undefined) deleted.push(h)
  }
  for (const [oldHandleStr, newHandles] of Object.entries(evo.modified ?? {})) {
    const inHash = handleToHash.get(Number(oldHandleStr))
    if (inHash === undefined) continue
    const outHashes = (newHandles as number[]).map((nh) => faceFingerprint(kernel, nh, hashUpperBound))
    modified.push(inHash, outHashes.length, ...outHashes)
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

/** brepkit 适配器返回类型：BrepEngineApi + brepkit 专属诊断 + 网格实体原语。 */
type BrepkitEngineExtras = BrepEngineApi & {
  getMeshFallbackCount(): number
  /**
   * 网格实体原语（`brep/mesh-solid.ts` 的 `MeshSolidKernelOps`）。
   *
   * 为什么放在适配器而不是 L1 契约面：`weldShellsAndFaces` / `unifyFaces` 是
   * brepkit **内核私有**的缝合/合并原语（L1 `BrepEngineApi` 没有对应概念——
   * OCCT 侧用 `sew`+`unifySameDomain` 才有等价语义，形态不同）。挂在适配器
   * 返回对象上，网格后端（`MeshSolidBackend`）经端口取用，契约面保持干净。
   */
  meshSolid: import('../brep/mesh-solid').MeshSolidKernelOps
}

/**
 * 三点外接圆（makeArcEdge 方言消化：occt 吃 3 点，brepkit 吃圆心+轴）。
 *
 * 圆心偏移取标准式 `d = ( |ab|²·(ac×n) + |ac|²·(n×ab) ) / (2·|n|²)`，`n = ab×ac`。
 * GOTCHA（弧缺陷，2026-09-30 实证）：旧式 `( |ac|²·(ab×n) + |ab|²·(n×ac) ) / (2·|n|²)`
 * 把两项的系数对调，等于整体取反——圆心落到弦的另一侧（实测 quarter arc 圆心 (20,0,0)
 * 而非 (0,0,0)，三点不等距），brepkit 据此生成 333° 的补弧（弧长 58.195 而非 πr/2）。
 * 判据是等距不变量 `|center−a| = |center−b| = |center−c|`。
 *
 * axis = n/|n| 即三点逆时针扫掠方向的右手法向；brepkit `makeCircleArc3d` 语义为
 * "沿法向看从 start 逆时针到 end"，故该轴向同时正确表达 ccw 与 cw 弧。
 */
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
  // center = a + ( ab2·(ac×n) + ac2·(n×ab) ) / (2·n²)
  const acxnx = acy * nz - acz * ny, acxny = acz * nx - acx * nz, acxnz = acx * ny - acy * nx
  const nxabx = ny * abz - nz * aby, nxaby = nz * abx - nx * abz, nxabz = nx * aby - ny * abx
  const denom = 2 * n2
  const len = Math.sqrt(n2)
  return {
    center: {
      x: a.x + (ab2 * acxnx + ac2 * nxabx) / denom,
      y: a.y + (ab2 * acxny + ac2 * nxaby) / denom,
      z: a.z + (ab2 * acxnz + ac2 * nxabz) / denom,
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
  // GOTCHA（2026-10-01）：本函数此前每次调用都新建一套闭包（knownFaces/knownSolids/
  // derivedFaces…）——即**新建一套句柄桥接层**。句柄号虽然对同一个 wasm 内核全局有效，
  // 但桥接层侧的类型登记表不同：A 层枚举出的面句柄交给 B 层做 getSubShapes，会被当
  // 实体走 tessellateSolidGrouped。BREP 引擎装配点与网格后端装配点都调本函数，必须
  // 拿到**同一个**对象。故按内核实例 memo 化（disposeBrepkit 会清掉）。
  if (memoizedPrimitives && memoizedKernel === kernel) return memoizedPrimitives
  liveKernel = kernel
  let lastFallbackCount = 0
  // 已知面句柄集合：getSubShapes(shape,'face') / makeRectangle / makeFace / buildTriFace
  // 返回的面在此登记；extrude/revolveVec 的 face 输入断言、getSubShapes 的
  // edge/vertex 分发都据此判定（brepkit 无 shape-type 分类 API，见下方注释）。
  const knownFaces = new Set<number>()
  // GOTCHA（2026-09-26 非实体句柄修复）：brepkit 的 tessellateSolidGrouped / getSolidFaces
  // 等 *Solid API 只吃 solid 句柄，传 face/wire/edge/compound 即抛
  // "invalid solid handle: index N out of bounds"。而 brepkit **没有 shape-type 分类 API**
  // （getFaceEdges(solid) 不抛错、会返回某一面的边，不能 try/catch 探测）。故 meshShape
  // 必须靠这组「已知句柄集合」在执行前静态分发，而不是运行时探测：
  //   knownFaces   → tessellateFace（JsMesh）
  //   knownWires   → getWireEdges + tessellateEdge 逐边采样成线段
  //   knownEdges   → tessellateEdge 直接采样成线段（wire.ts smooth 路径 interpolatePoints 返回 edge）
  //   knownCompounds→ 逐子句柄按其类型 tessellate 后合并（sectionByPlane 面组 / importStep 多实体）
  // 不在任何集合里的句柄一律按 solid 走 tessellateSolidGrouped（实体创建不入集合，天然落此路径）。
  const knownWires = new Set<number>()
  const knownEdges = new Set<number>()
  // GOTCHA: getSolidFaces returns GLOBAL face indices (0..5, 6..11, ...) that collide
  // with solid handles (per-type namespace). Enumerated sub-faces must NOT pollute
  // knownFaces, else measuring a later solid whose handle number equals an old
  // enumerated face gets mis-tessellated as a face. derivedFaces is consulted ONLY by
  // getSubShapes edge/vertex drilling, never by meshShape/getBoundingBox.
  const derivedFaces = new Set<number>()
  // 虚拟 compound 句柄计数器（非实体子句柄不进内核 makeCompound，见 makeCompound GOTCHA）。
  const knownCompounds = new Map<number, number[]>()
  let virtualCompoundCounter = 0
  // GOTCHA（2026-09-26）：brepkit 句柄按**类型分命名空间**——solid/face/wire/edge 各自从 0 计数
  // （实测 edge=wire=face=solid=0 可共存）。因此「某编号 N 在 knownFaces」与「某编号 N 是 solid」
  // 并不互斥：新 solid 恰好复用了早先某 face 的编号时，knownFaces.has(N) 会把 solid 误判成 face
  // （实测 box makeBox 返回 solid 2，撞 profile 早先的 face 2 → cloneShape 走 copyFace 崩溃）。
  // 建 solid 时必须从 knownFaces/knownWires/knownEdges/derivedFaces 抹掉该编号，让默认 solid 路径生效。
  // derivedFaces 也必须清：getSubShapes(solid,'edge') 会查 derivedFaces.has(s) 误走 getFaceEdges。
  // GOTCHA（2026-10-01 实测）：`derivedFaces` 是**全局**面句柄号集合，枚举 solid A 的面会把
  // 面号 0..N 写进去；此后对**裸句柄号恰好相同的另一个 solid**做 getSubShapes(...,'edge')
  // 时，`derivedFaces.has(s)` 为真 → isFaceLike 误判 → 走 getFaceEdges 只拿到一张面的 4 条边
  // （实测 box：12 条边变 4 条）。故必须显式登记 solid 句柄：实体永远不是 face-like。
  const knownSolids = new Set<number>()
  const markSolid = (h: number): number => {
    knownFaces.delete(h); knownWires.delete(h); knownEdges.delete(h); knownCompounds.delete(h); derivedFaces.delete(h)
    knownSolids.add(h)
    return h
  }
  /** 实体数组批量登记（阵列族返回多个实体）。 */
  const markSolids = (list: number[]): number[] => list.map(markSolid)
  /**
   * 句柄类型解析：**标签优先**，无标签时退回已知集合（历史行为）。
   *
   * 标签是权威来源——集合的 key 是**裸句柄号**，face 3 与 edge 3 会共存于不同集合，
   * 靠集合无法区分。故有标签（非 0）时直接用标签，集合里的同名条目一律忽略；
   * 只有无标签句柄（实体/compound/构造 API 外传入）才走集合分发，行为与加标签前一致。
   */
  const resolveKind = (shape: BrepHandle, s: number): number => {
    const tagged = kindOf(shape)
    if (tagged !== KIND_SOLID) return tagged
    // 已登记的实体优先：knownFaces/knownEdges 的 key 是裸句柄号，历史登记（如
    // getSubShapes(face,'edge') 写 knownEdges）与后来新建的 solid 号同号时会把实体判成边。
    if (knownSolids.has(s)) return KIND_SOLID
    if (knownFaces.has(s)) return KIND_FACE
    if (knownWires.has(s)) return KIND_WIRE
    if (knownEdges.has(s)) return KIND_EDGE
    return KIND_SOLID
  }
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

  // ── 非实体 tessellation 助手（meshShape 分发用） ──
  // GOTCHA：tessellateFace 返回 JsMesh（positions/normals 为 Float64Array、indices 为 Uint32Array），
  // **不是** tessellateSolidGrouped 的 JSON 字符串——两者形态不同，勿混用 JSON.parse。
  type JsMesh = { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number>; vertexCount: number; triangleCount: number }

  /** 单个 face → BrepMeshResult（tessellateFace）。 */
  const faceMesh = (f: number, deflection: number, angular: number): BrepMeshResult => {
    const jm = kernel.tessellateFace(f, deflection, angular) as JsMesh
    const positions = arr(jm.positions)
    const normals = arr(jm.normals)
    const indices = arr(jm.indices)
    const triCount = jm.triangleCount > 0 ? jm.triangleCount : indices.length / 3
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      vertexCount: positions.length / 3,
      triangleCount: triCount,
      faceGroups: new Int32Array([0, indices.length, faceFingerprint(kernel, f, BREP_HASH_BOUND)]),
      faceCount: 1,
    }
  }

  /** 一组 edge 句柄 → 线段 mesh（positions 为采样点、indices 为端点对）。 */
  // GOTCHA：tessellateEdge(edge, N) 返回扁平 [x,y,z,...] 采样点（NURBS 才采样 N 点，
  // 直线边只回端点），不是三角网格；wire/curve 显示吃「端点对」索引（与 mesh 路径 wireMesh 同构）。
  const edgesToLineMesh = (edgeHandles: number[], deflection: number): BrepMeshResult => {
    const positions: number[] = []
    const indices: number[] = []
    // 采样密度：按 deflection 粗采样即可（1D 线框显示，非精确几何）。
    const nPts = Math.max(12, Math.round(4 / Math.max(deflection, 0.01)))
    for (const e of edgeHandles) {
      const pts = arr(kernel.tessellateEdge(e, nPts))
      const base = positions.length / 3
      for (let i = 0; i < pts.length; i++) positions.push(pts[i]!)
      const verts = pts.length / 3
      for (let i = 0; i < verts - 1; i++) indices.push(base + i, base + i + 1)
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(positions.length),
      indices: new Uint32Array(indices),
      vertexCount: positions.length / 3,
      triangleCount: 0,
      faceGroups: new Int32Array(0),
      faceCount: 0,
    }
  }

  /** wire → 线段 mesh（getWireEdges 取边集后逐边采样）。 */
  const wireMesh = (wire: number, deflection: number): BrepMeshResult => {
    const edges = arr(kernel.getWireEdges(wire))
    return edgesToLineMesh(edges, deflection)
  }

  /** solid → BrepMeshResult（tessellateSolidGrouped，原 meshShape 实体路径抽出）。 */
  const solidMesh = (solid: number, deflection: number, angular: number): BrepMeshResult => {
    const raw = kernel.tessellateSolidGrouped(solid, deflection, angular)
    const m = JSON.parse(raw) as { positions: number[]; normals: number[]; indices: number[]; faceOffsets: number[] }
    // faceOffsets 形如 [start0, start1, ..., totalEnd]：以「索引数组单位」计的每面偏移
    // （2026-09-19 实测）。**L1 契约的 faceGroups 就是索引单位**（与 OCCT 一致，
    // 见 brep/engine/types.BrepMeshResult）——此处原样透传，不得再除以 3。
    // GOTCHA（2026-10-01）：旧实现除以 3 换成三角形单位，与 topologyExt 的 `/3`
    // 叠加 → 面行区间缩小 3 倍。
    const fo = m.faceOffsets
    const faceCount = Math.max(0, fo.length - 1)
    const faceHashes: number[] = []
    try {
      const faces = arr(kernel.getSolidFaces(solid))
      for (let i = 0; i < faceCount && i < faces.length; i++) faceHashes.push(faceFingerprint(kernel, faces[i]!, BREP_HASH_BOUND))
    } catch { /* 非实体：faceHash 置 0 */ }
    const faceGroups = new Int32Array(faceCount * 3)
    for (let i = 0; i < faceCount; i++) {
      faceGroups[i * 3] = fo[i]!
      faceGroups[i * 3 + 1] = fo[i + 1]! - fo[i]!
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
  }

  /** compound → 逐子句柄 tessellate 后合并（sectionByPlane 面组 / importStep 多实体）。 */
  const compoundMesh = (children: number[], deflection: number, angular: number): BrepMeshResult => {
    const positions: number[] = []
    const normals: number[] = []
    const indices: number[] = []
    const faceGroups: number[] = []
    let indexOffset = 0
    for (const c of children) {
      let sub: BrepMeshResult
      if (knownFaces.has(c)) {
        sub = faceMesh(c, deflection, angular)
      } else if (knownWires.has(c)) {
        sub = wireMesh(c, deflection)
      } else if (knownEdges.has(c)) {
        sub = edgesToLineMesh([c], deflection)
      } else {
        // 子句柄按 solid 处理（importStep 多实体 / makeCompound(solids)）。
        sub = solidMesh(c, deflection, angular)
      }
      const vOffset = positions.length / 3
      for (let i = 0; i < sub.positions.length; i++) positions.push(sub.positions[i]!)
      for (let i = 0; i < sub.normals.length; i++) normals.push(sub.normals[i] ?? 0)
      for (let i = 0; i < sub.indices.length; i++) indices.push(sub.indices[i]! + vOffset)
      if (sub.faceGroups) {
        for (let i = 0; i < sub.faceGroups.length; i += 3) {
          faceGroups.push((sub.faceGroups[i] ?? 0) + indexOffset, sub.faceGroups[i + 1] ?? 0, sub.faceGroups[i + 2] ?? 0)
        }
      }
      indexOffset += sub.indices.length
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      faceGroups: new Int32Array(faceGroups),
      faceCount: faceGroups.length / 3,
    }
  }

  // ── 按句柄类型深拷贝（transform/copy 族分发用） ──
  // GOTCHA：brepkit copySolid/copyFace/copyWire 三者入参严格对应 solid/face/wire 句柄，
  // 传错即崩溃；transformSolid/transformFace/transformWire 均为「原地修改」void。
  // place/translate 等会作用在 profile 产出的 face 上（sew 用例 place 两张 face），
  // 故必须按 knownFaces/knownWires 分发，不能一律 copySolid。
  // kind 为调用方句柄的类型标签（0 = solid）：句柄标签是**权威判定**，knownFaces/knownWires
  // 只作无标签时的兜底（枚举出的面句柄只进 derivedFaces，不在 knownFaces 里）。
  const cloneShape = (shape: number, kind: number = KIND_SOLID): number => {
    if (kind === KIND_FACE || knownFaces.has(shape)) { const c = kernel.copyFace(shape); knownFaces.add(c); return c }
    if (kind === KIND_WIRE || knownWires.has(shape)) { const c = kernel.copyWire(shape); knownWires.add(c); return c }
    return markSolid(kernel.copySolid(shape))
  }

  /** 深拷贝 + 原地仿射变换（matrix 已经 toKernelMatrix 归一为 16 元素 4×4）。 */
  const cloneAndTransform = (shape: number, matrix16: number[], kind: number = KIND_SOLID): number => {
    const c = cloneShape(shape, kind)
    const m = Float64Array.from(matrix16)
    if (kind === KIND_FACE || knownFaces.has(c)) kernel.transformFace(c, m)
    else if (kind === KIND_WIRE || knownWires.has(c)) kernel.transformWire(c, m)
    else kernel.transformSolid(c, m)
    return c
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
    makeBox(dx: number, dy: number, dz: number): BrepHandle { return asHandle(markSolid(kernel.makeBox(dx, dy, dz))) },
    makeBoxFromCorners(corner1: BrepVec3, corner2: BrepVec3): BrepHandle {
      const dx = Math.abs(corner2.x - corner1.x), dy = Math.abs(corner2.y - corner1.y), dz = Math.abs(corner2.z - corner1.z)
      const h = markSolid(kernel.makeBox(dx, dy, dz))
      // ⚠️ transformSolid 是「原地修改、返回 undefined」——makeBox 的句柄本身即新实体，
      // 直接原地变换后返回 h；若写 `asHandle(transformSolid(...))` 会拿到 undefined 句柄
      // （2026-09-25 实证：导致 splitBrep 基于半空间盒的 common/cut 全部失效）。
      kernel.transformSolid(h, toKernelMatrix(translationMatrix(
        Math.min(corner1.x, corner2.x), Math.min(corner1.y, corner2.y), Math.min(corner1.z, corner2.z),
      )))
      return asHandle(h)
    },
    makeCylinder(radius: number, height: number): BrepHandle { return asHandle(markSolid(kernel.makeCylinder(radius, height))) },
    makeSphere(radius: number): BrepHandle { return asHandle(markSolid(kernel.makeSphere(radius, 32))) },
    makeCone(r1: number, r2: number, height: number): BrepHandle { return asHandle(markSolid(kernel.makeCone(r1, r2, height))) },
    makeRectangle(width: number, height: number): BrepHandle {
      const f = kernel.makeRectangle(width, height)
      knownFaces.add(f)
      return asFace(f)
    },
    makeEllipsoid(rx: number, ry: number, rz: number): BrepHandle { return asHandle(markSolid(kernel.makeEllipsoid(rx, ry, rz))) },
    makeTorus(majorRadius: number, minorRadius: number): BrepHandle { return asHandle(markSolid(kernel.makeTorus(majorRadius, minorRadius, 64))) },
    makeVertex(x: number, y: number, z: number): BrepHandle { return asVertex(kernel.makeVertex(x, y, z)) },

    // ── 造型运算 ──
    extrude(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle {
      // 方言归一（§3.6-1）：L1 口径是挤出向量；brepkit 原生吃 (face, dir, distance)。
      const s = asNum(shape)
      if (!knownFaces.has(s)) {
        fail('extrude requires a face input (plan §3.6-1); got a handle that is not a known face')
      }
      const len = Math.hypot(dx, dy, dz)
      if (len === 0) fail('extrude: zero-length extrusion vector')
      return asHandle(markSolid(kernel.extrude(s, dx / len, dy / len, dz / len, len)))
    },
    revolveVec(shape: BrepHandle, center: BrepVec3, direction: BrepVec3, angleDeg: number): BrepHandle {
      // 方言归一：brepkit revolve 只吃 face（与 extrude 同族断言）。
      const s = asNum(shape)
      if (!knownFaces.has(s)) {
        fail('revolveVec requires a face input; got a handle that is not a known face')
      }
      return asHandle(markSolid(kernel.revolve(
        s, center.x, center.y, center.z, direction.x, direction.y, direction.z, angleDeg,
      )))
    },
    sew(shapesList: BrepHandle[], tolerance?: number): BrepHandle {
      return asHandle(markSolid(kernel.sewFaces(Uint32Array.from(shapesList.map(asNum)), tolerance ?? 1e-6)))
    },
    sewAndSolidify(faces: BrepHandle[], _tolerance?: number): BrepHandle {
      // brepkit 的 makeSolid 即「缝合并固化成实体」（sewFaces + 建 solid）。
      return asHandle(markSolid(kernel.makeSolid(Uint32Array.from(faces.map(asNum)))))
    },
    shell(solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, _tolerance: number): BrepHandle {
      // brepkit 参数序 (solid, thickness, open_faces)；tolerance 内核固定。
      return asHandle(markSolid(kernel.shell(asNum(solid), thickness, Uint32Array.from(facesToRemove.map(asNum)))))
    },
    hullFromPoints(points: BrepVec3[], _tolerance: number): BrepHandle {
      return asHandle(markSolid(kernel.convexHull(flattenPoints(points))))
    },

    // ── 布尔与分割 ──
    fuse(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(markSolid(trackFallback(kernel.fuse(asNum(a), asNum(b))))) },
    cut(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(markSolid(trackFallback(kernel.cut(asNum(a), asNum(b))))) },
    common(a: BrepHandle, b: BrepHandle): BrepHandle {
      // brepkit 无 `common` 原生名；交集语义由 `intersect` 承担（method-map: dialect）。
      return asHandle(markSolid(trackFallback(kernel.intersect(asNum(a), asNum(b)))))
    },
    intersect(a: BrepHandle, b: BrepHandle): BrepHandle { return asHandle(markSolid(trackFallback(kernel.intersect(asNum(a), asNum(b))))) },
    fuseAll(shapesList: BrepHandle[]): BrepHandle {
      return asHandle(markSolid(trackFallback(kernel.fuseAll(Int32Array.from(shapesList.map(asNum))))))
    },
    sectionByPlane(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle[] {
      // brepkit 原生 section(solid, plane) 返回剖面 face 句柄组（§3.6-2 新中立名）。
      // GOTCHA：brepkit section 返回的是 **face** 句柄（不是 edge/wire），必须登记进 knownFaces，
      // 否则 op 层 makeCompound(这些 face) 后送 meshShape 会按 solid 路径崩溃。
      const s = asNum(shape)
      const faces = arr(kernel.section(
        s, point.x, point.y, point.z, normal.x, normal.y, normal.z,
      ))
      for (const f of faces) knownFaces.add(f)
      return faces.map(asHandle)
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
      markSolid(a); markSolid(b)
      return side(a) >= side(b)
        ? { positive: asHandle(a), negative: asHandle(b) }
        : { positive: asHandle(b), negative: asHandle(a) }
    },

    // ── 倒角与圆角（Q7：只对齐等距 + 距角两种粒度）──
    chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle {
      return asHandle(markSolid(trackFallback(kernel.chamfer(asNum(solid), Uint32Array.from(edges.map(asNum)), distance))))
    },
    chamferDistAngle(solid: BrepHandle, edges: BrepHandle[], distance: number, angleDeg: number): BrepHandle {
      // 方言映射：L1 chamferDistAngle ↔ brepkit chamferDistanceAngle。
      // ⚠️ 单位方言：L1 口径是**度**（`AddDA(distance, angleDeg, E, F)`），brepkit 内核吃**弧度**
      // （2026-09-25 实证：传 45 抛 "angle must be less than π/2"；传 π/4 正常倒角）。
      const angleRad = (angleDeg * Math.PI) / 180
      return asHandle(markSolid(trackFallback(kernel.chamferDistanceAngle(
        asNum(solid), Uint32Array.from(edges.map(asNum)), distance, angleRad,
      ))))
    },
    fillet(solid: BrepHandle, edges: BrepHandle[], radius: number): BrepHandle {
      return asHandle(markSolid(trackFallback(kernel.fillet(asNum(solid), Uint32Array.from(edges.map(asNum)), radius))))
    },
    filletVariable(solid: BrepHandle, edge: BrepHandle, startRadius: number, endRadius: number): BrepHandle {
      // 方言映射：L1 filletVariable(solid, edge, startRadius, endRadius)（单边变半径）
      // ↔ brepkit filletVariable(solid, json) 吃**序列** `[{edge, radius1, radius2}, ...]`。
      // ⚠️ 直接传 4 个位置参数会触发 wasm memory out of bounds（2026-09-25 实证）。
      const spec = JSON.stringify([{ edge: asNum(edge), radius1: startRadius, radius2: endRadius }])
      return asHandle(markSolid(trackFallback(kernel.filletVariable(asNum(solid), spec))))
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
      return withKind(kindOf(shape), cloneAndTransform(asNum(shape), toKernelMatrix(translationMatrix(dx, dy, dz)), kindOf(shape)))
    },
    scale(shape: BrepHandle, center: BrepVec3, factor: number): BrepHandle {
      return withKind(kindOf(shape), cloneAndTransform(asNum(shape), toKernelMatrix(scaleMatrix(center, factor)), kindOf(shape)))
    },
    transform(shape: BrepHandle, matrix: number[]): BrepHandle {
      return withKind(kindOf(shape), cloneAndTransform(asNum(shape), toKernelMatrix(matrix), kindOf(shape)))
    },
    located(shape: BrepHandle, matrix: number[]): BrepHandle {
      return withKind(kindOf(shape), cloneAndTransform(asNum(shape), toKernelMatrix(matrix), kindOf(shape)))
    },
    locate(shape: BrepHandle, matrix: number[]): BrepHandle {
      return withKind(kindOf(shape), cloneAndTransform(asNum(shape), toKernelMatrix(matrix), kindOf(shape)))
    },
    generalTransform(shape: BrepHandle, matrix: number[]): BrepHandle {
      return withKind(kindOf(shape), cloneAndTransform(asNum(shape), toKernelMatrix(matrix), kindOf(shape)))
    },
    copy(shape: BrepHandle): BrepHandle { return withKind(kindOf(shape), cloneShape(asNum(shape), kindOf(shape))) },
    copyShape(shape: BrepHandle): BrepHandle { return withKind(kindOf(shape), cloneShape(asNum(shape), kindOf(shape))) },
    composeTransform(m1: number[], m2: number[]): number[] {
      // 方言：L1 是 3×4 行主序 12 元素；brepkit composeTransforms 吃/回 4×4 16 元素。
      const r = kernel.composeTransforms(
        Float64Array.from(toKernelMatrix(m1)),
        Float64Array.from(toKernelMatrix(m2)),
      )
      return Array.from(r as ArrayLike<number>).slice(0, 12)
    },
    mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle {
      return withKind(kindOf(shape), kernel.mirror(asNum(shape), point.x, point.y, point.z, normal.x, normal.y, normal.z))
    },

    // ── 阵列 ──
    // brepkit wasm 的 pattern 内核函数都返回 compound（含全部副本）→ 经 getCompoundSolids 拆成数组。
    linearPattern(shape: BrepHandle, direction: BrepVec3, spacing: number, count: number): BrepHandle[] {
      const compound = kernel.linearPattern(asNum(shape), direction.x, direction.y, direction.z, spacing, count)
      // 阵列内核返回 compound（原始句柄）→ 拆成实体数组并逐个登记（见 markSolid GOTCHA）。
      return markSolids(arr(kernel.getCompoundSolids(compound))).map(asHandle)
    },
    circularPattern(shape: BrepHandle, _center: BrepVec3, axis: BrepVec3, _angleStep: number, count: number): BrepHandle[] {
      // ⚠️ brepkit wasm circularPattern(solid, ax, ay, az, count) 无 center/angle 参数：
      // 固定整圆均分（每份 360°/count）。fullAngle=360 时与 occt 语义一致；
      // 其它角度跨度无法表达（语义限制记录于此，parity 测试用整圆）。
      const compound = kernel.circularPattern(asNum(shape), axis.x, axis.y, axis.z, count)
      return markSolids(arr(kernel.getCompoundSolids(compound))).map(asHandle)
    },
    gridPattern(shape: BrepHandle, directionX: BrepVec3, directionY: BrepVec3, spacingX: number, spacingY: number, countX: number, countY: number): BrepHandle {
      return asHandle(markSolid(kernel.gridPattern(
        asNum(shape),
        directionX.x, directionX.y, directionX.z,
        directionY.x, directionY.y, directionY.z,
        spacingX, spacingY, countX, countY,
      )))
    },

    // ── 曲线构造 ──
    makeLineEdge(start: BrepVec3, end: BrepVec3): BrepHandle {
      const e = kernel.makeLineEdge(start.x, start.y, start.z, end.x, end.y, end.z)
      knownEdges.add(e)
      return asEdge(e)
    },
    makeArcEdge(start: BrepVec3, mid: BrepVec3, end: BrepVec3): BrepHandle {
      // 方言消化：occt 吃 3 点；brepkit makeCircleArc3d 吃 (start,end,center,axis)。
      const { center, axis } = circumcircle(start, mid, end)
      const e = kernel.makeCircleArc3d(
        start.x, start.y, start.z,
        end.x, end.y, end.z,
        center.x, center.y, center.z,
        axis.x, axis.y, axis.z,
      )
      knownEdges.add(e)
      return asEdge(e)
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
      const e = kernel.makeNurbsEdge(
        first.x, first.y, first.z,
        last.x, last.y, last.z,
        degree, knots, flattenPoints(controlPoints), weights,
      )
      knownEdges.add(e)
      return asEdge(e)
    },
    makeBSplineEdge(
      poles: number[],
      weights: number[],
      knots: number[],
      multiplicities: number[],
      degree: number,
      periodic = false,
    ): BrepHandle {
      // 方言消化：L1 吃 occt 形态 (poles, weights, knots, multiplicities, degree),
      // brepkit makeNurbsEdge 吃 (start,end,degree, **展开后** knots, control_points, weights)。
      // 两侧 knots 的表示不同：occt 给「去重值 + 多重度」两个平行数组，brepkit 要
      // 逐项重复后的整条节点向量（与 makeBezierEdge 里手工铺 [0]×n+[1]×n 同一口径）。
      const controlPoints: BrepVec3[] = []
      for (let i = 0; i + 2 < poles.length; i += 3) {
        controlPoints.push({ x: poles[i]!, y: poles[i + 1]!, z: poles[i + 2]! })
      }
      const n = controlPoints.length
      if (n < 2) fail('makeBSplineEdge: need at least 2 poles')
      const expanded: number[] = []
      for (let i = 0; i < knots.length; i++) {
        const rep = multiplicities[i] ?? 1
        for (let j = 0; j < rep; j++) expanded.push(knots[i]!)
      }
      const first = controlPoints[0]!
      const last = controlPoints[n - 1]!
      const e = kernel.makeNurbsEdge(
        first.x, first.y, first.z,
        last.x, last.y, last.z,
        degree,
        Float64Array.from(expanded),
        flattenPoints(controlPoints),
        weights.length === n ? Float64Array.from(weights) : new Float64Array(n).fill(1),
      )
      void periodic
      knownEdges.add(e)
      return asEdge(e)
    },
    makeCircleEdge(center: BrepVec3, normal: BrepVec3, radius: number): BrepHandle {
      const e = kernel.makeCircleEdge(
        center.x, center.y, center.z, normal.x, normal.y, normal.z, radius,
      )
      knownEdges.add(e)
      return asEdge(e)
    },

    // ── 拓扑构造 ──
    makeWire(edges: BrepHandle[]): BrepHandle {
      const w = kernel.makeWire(Int32Array.from(edges.map(asNum)), false)
      knownWires.add(w)
      return asWire(w)
    },
    makeFace(wire: BrepHandle): BrepHandle {
      const f = kernel.makeFaceFromWire(asNum(wire))
      knownFaces.add(f)
      return asFace(f)
    },
    makeCompound(shapesList: BrepHandle[]): BrepHandle {
      const kids = arr(shapesList.map(asNum))
      // GOTCHA（2026-09-26）：brepkit makeCompound 只接受 **solid** 句柄——把 face/wire
      // （sectionByPlane 截面面组）塞进去即抛 "invalid solid handle"。非实体子句柄时
      // 不调内核，改用高段虚拟句柄（0x20000000+，避开类型标签 bit26..28），仅靠 knownCompounds 表分发
      // meshShape/wireframe/getSubShapes/getBoundingBox，不触达内核。
      const hasNonSolid = kids.some((k) => knownFaces.has(k) || knownWires.has(k) || knownEdges.has(k) || knownCompounds.has(k))
      if (hasNonSolid) {
        virtualCompoundCounter++
        const v = 0x20000000 + virtualCompoundCounter
        knownCompounds.set(v, kids)
        return asHandle(v)
      }
      const c = kernel.makeCompound(Int32Array.from(kids))
      knownCompounds.set(c, kids)
      return asHandle(c)
    },
    addHolesInFace(face: BrepHandle, holeWires: BrepHandle[]): BrepHandle {
      // addHolesToFace 返回**新 face 句柄**（同曲面 + 内孔 wire），必须登记进 knownFaces，
      // 否则 profile(op) 带孔面送 meshShape 会落到 solid 路径崩溃。
      const f = kernel.addHolesToFace(asNum(face), Int32Array.from(holeWires.map(asNum)))
      knownFaces.add(f)
      return asFace(f)
    },
    buildTriFace(a: BrepVec3, b: BrepVec3, c: BrepVec3): BrepHandle {
      const f = kernel.makePolygon(flattenPoints([a, b, c]))
      knownFaces.add(f)
      return asFace(f)
    },

    // ── 三角化（BREP→mesh 唯一出口） ──
    meshShape(shape: BrepHandle, options?: BrepTessellateOptions): BrepMeshResult {
      const deflection = options?.linearDeflection ?? DEFAULT_LINEAR_DEFLECTION.as(mm)
      const angular = options?.angularDeflection ?? 0.5
      const s = asNum(shape)
      // 非实体句柄按类型静态分发（标签优先，见文件头 GOTCHA：brepkit 无 shape-type 分类 API）。
      // 顺序：face → wire → edge → compound → solid。实体创建不入任何集合，天然落 solid 路径。
      const kind = resolveKind(shape, s)
      if (kind === KIND_FACE) return faceMesh(s, deflection, angular)
      if (kind === KIND_WIRE) return wireMesh(s, deflection)
      if (kind === KIND_EDGE) return edgesToLineMesh([s], deflection)
      const compoundChildren = knownCompounds.get(s)
      if (compoundChildren) return compoundMesh(compoundChildren, deflection, angular)
      // solid（或未登记句柄）：走原 tessellateSolidGrouped 路径。
      return solidMesh(s, deflection, angular)
    },
    wireframe(shape: BrepHandle, deflection?: number): BrepEdgeData {
      const d = deflection ?? DEFAULT_LINEAR_DEFLECTION.as(mm)
      const s = asNum(shape)
      // GOTCHA：meshEdgesAll 是 solid-only API——buildTopologyFromMesh 会对 face/wire/edge
      // 产物调 wireframe(...)，传入非实体句柄即抛 "invalid solid handle"。按已知集合分发：
      // face -> getFaceEdges；wire -> getWireEdges；edge -> [self]；否则 solid 走 meshEdgesAll。
      let edgeHandles: number[] | null = null
      const kind = resolveKind(shape, s)
      if (kind === KIND_FACE) edgeHandles = arr(kernel.getFaceEdges(s))
      else if (kind === KIND_WIRE) edgeHandles = arr(kernel.getWireEdges(s))
      else if (kind === KIND_EDGE) edgeHandles = [s]
      else if (knownCompounds.has(s)) {
        // compound（sectionByPlane 面组）：逐子面收集边。
        edgeHandles = []
        for (const k of knownCompounds.get(s)!) {
          if (knownFaces.has(k)) edgeHandles.push(...arr(kernel.getFaceEdges(k)))
          else if (knownWires.has(k)) edgeHandles.push(...arr(kernel.getWireEdges(k)))
          else if (knownEdges.has(k)) edgeHandles.push(k)
        }
      }
      if (edgeHandles) {
        const nPts = Math.max(12, Math.round(4 / Math.max(d, 0.01)))
        const positions: number[] = []
        // offsets 为**浮点单位**（L1 契约：edgeGroups = [pointStart_float, pointCount_float, hash]）
        const offsets: number[] = [0]
        for (const e of edgeHandles) {
          const pts = arr(kernel.tessellateEdge(e, nPts))
          for (const p of pts) positions.push(p)
          offsets.push(positions.length)
        }
        const edgeGroups = new Int32Array(edgeHandles.length * 3)
        for (let i = 0; i < edgeHandles.length; i++) {
          edgeGroups[i * 3] = offsets[i] ?? 0
          edgeGroups[i * 3 + 1] = (offsets[i + 1] ?? positions.length) - (offsets[i] ?? 0)
          // hash 必须与 hashCode(edge, BREP_HASH_BOUND) 同源，否则 topologyExt 查不到折线。
          edgeGroups[i * 3 + 2] = edgeFingerprint(kernel, edgeHandles[i]!, BREP_HASH_BOUND)
        }
        return { points: new Float32Array(positions), edgeGroups, pointCount: positions.length, edgeCount: edgeHandles.length }
      }
      // solid（或未登记句柄）：走原 meshEdgesAll 路径。
      // JsEdgeLines：edgeCount/offsets/positions 均为属性（offsets/positions 为 TypedArray，2026-09-19 实测）
      const me = kernel.meshEdgesAll(s, d, 0.5) as {
        edgeCount: number; offsets: ArrayLike<number>; positions: ArrayLike<number>
      }
      const edgeCount = Number(me.edgeCount)
      const offsets = arr(me.offsets)
      const positions = arr(me.positions)
      // hash：meshEdgesAll 与 getSolidEdges 同序（同一次遍历），据此回填真实边指纹；
      // 取不到（数量不符）时退化为序号——此时 topologyExt 查不到折线，曲面边走
      // 曲线采样兜底（功能可用，只是丢掉内核线框数据）。
      let solidEdges: number[] | null = null
      try { const es = arr(kernel.getSolidEdges(s)); if (es.length === edgeCount) solidEdges = es } catch { /* 非实体 */ }
      const edgeGroups = new Int32Array(edgeCount * 3)
      for (let i = 0; i < edgeCount; i++) {
        const start = offsets[i] ?? 0
        const count = (offsets[i + 1] ?? positions.length) - start
        edgeGroups[i * 3] = start
        edgeGroups[i * 3 + 1] = count
        edgeGroups[i * 3 + 2] = solidEdges
          ? edgeFingerprint(kernel, solidEdges[i]!, BREP_HASH_BOUND)
          : i
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
      // 出口一律按 **type 参数**打类型标签（`type` 就是调用方声明的子形类型，是权威来源；
      // 不用内核反查——brepkit 无法反查类型，见文件头句柄桥接 GOTCHA）。
      const tag = (list: number[]): BrepHandle[] => {
        switch (type) {
          case 'face': return list.map(asFace)
          case 'edge': return list.map(asEdge)
          case 'vertex': return list.map(asVertex)
          case 'wire': return list.map(asWire)
          default: return list.map(asHandle)
        }
      }
      // ── A. 有类型标签：按标签分发，**不登记 knownEdges** ──
      // GOTCHA（2026-10-01 实测回归）：历史分支里 `es.forEach(e => knownEdges.add(e))` 会把
      // 面/线的边号写进 knownEdges，而 knownEdges 的 key 是**裸句柄号**、会与后来新建的
      // solid 号相撞 → resolveKind 把实体判成边 → getBoundingBox 返回边的退化 bbox
      // （实测 8 个 op 的 AABB 全错）。标签句柄自带类型，登记已无必要，故这里一律不登记。
      const tagged = kindOf(shape)
      if (tagged === KIND_FACE) {
        if (type === 'face') return [asFace(s)]
        if (type === 'edge') return tag(arr(kernel.getFaceEdges(s)))
        if (type === 'vertex') return tag(arr(kernel.getFaceVertices(s)))
        return []
      }
      if (tagged === KIND_WIRE) {
        if (type === 'edge') return tag(arr(kernel.getWireEdges(s)))
        return []
      }
      if (tagged === KIND_EDGE) {
        // input is itself an edge (wire.ts smooth path: interpolatePoints returns edge)
        if (type === 'edge') return [asEdge(s)]
        return []
      }
      // ── B. 无标签：逐字沿用历史集合分发（含 knownEdges 登记），行为与加标签前一致 ──
      // GOTCHA（2026-09-26 非实体句柄修复）：buildTopologyFromMesh 会对**面产物**
      // 调 getSubShapes(face,'face')。brepkit 的 getSolidFaces/getShellFaces 是 solid-only，
      // 对面句柄一个抛 "invalid solid handle"、catch 里再抛 "invalid shell handle"——
      // 两跳都不被捕获即崩溃。无标签时靠已知集合先分发。
      if (knownFaces.has(s)) {
        if (type === 'face') return [asFace(s)]
        if (type === 'edge') { const es = arr(kernel.getFaceEdges(s)); es.forEach((e) => knownEdges.add(e)); return tag(es) }
        if (type === 'vertex') return tag(arr(kernel.getFaceVertices(s)))
        return []
      }
      if (knownWires.has(s)) {
        if (type === 'edge') { const es = arr(kernel.getWireEdges(s)); es.forEach((e) => knownEdges.add(e)); return tag(es) }
        return []
      }
      if (knownEdges.has(s)) {
        if (type === 'edge') return [asEdge(s)]
        return []
      }
      const compKids = knownCompounds.get(s)
      if (compKids) {
        // compound（sectionByPlane 面组 / makeCompound 多实体 / importStep 多实体）：
        // 'face' 返回子面，'solid' 返回子实体，'edge' 返回各子句柄的边，其余空。
        if (type === 'face') return tag(compKids.filter((k) => knownFaces.has(k)))
        if (type === 'solid') return tag(compKids.filter((k) => !knownFaces.has(k) && !knownWires.has(k) && !knownEdges.has(k)))
        if (type === 'edge') {
          // 2026-10-02 补：此前 compound 的边查询落到 `return []`，会让归一化后的
          // getLength(compound) 静默变 0。按子句柄的已知类型分发，与 occt 的
          // getSubShapes(compound,'edge')（返回全部子边）对齐。
          const out: number[] = []
          for (const kid of compKids) {
            if (knownFaces.has(kid)) out.push(...arr(kernel.getFaceEdges(kid)))
            else if (knownWires.has(kid)) out.push(...arr(kernel.getWireEdges(kid)))
            else if (knownEdges.has(kid)) out.push(kid)
            else out.push(...arr(kernel.getSolidEdges(kid)))
          }
          return tag(out)
        }
        return []
      }
      let list: number[]
      // 实体句柄（knownSolids）永远不是 face-like——`derivedFaces` 只装「枚举出来的面号」，
      // 与 solid 号共用一个裸数字空间，不排除会造成误判（见 knownSolids 注释）。
      const isFaceLike = knownFaces.has(s) || (derivedFaces.has(s) && !knownSolids.has(s))
      if (type === 'face') {
        // 输入可能是 solid 或 shell。枚举到的子面登记到 derivedFaces（不进 knownFaces，
        // 避免与 solid 句柄撞号——见 derivedFaces 注释）。
        try { list = arr(kernel.getSolidFaces(s)) } catch { list = arr(kernel.getShellFaces?.(s) ?? []) }
        for (const f of list) derivedFaces.add(f)
      } else if (type === 'edge') {
        list = isFaceLike
          ? arr(kernel.getFaceEdges(s))
          : arr(kernel.getSolidEdges(s))
      } else if (type === 'vertex') {
        list = isFaceLike
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
      return tag(list)
    },
    subShapeHashes(shape: BrepHandle, type: BrepSubShapeType, hashUpperBound: number): number[] {
      if (type !== 'face') fail(`subShapeHashes(${type}): only 'face' is supported by brepkit`)
      const s = asNum(shape)
      // GOTCHA：buildTopologyFromMesh 会对面产物调 subShapeHashes(face,'face')；
      // getSolidFaces 是 solid-only，对面句柄崩溃。输入本身是面时，哈希即其自身指纹。
      const kind = resolveKind(shape, s)
      if (kind === KIND_FACE) return [faceFingerprint(kernel, s, hashUpperBound)]
      // wire/edge 无面；compound（sectionByPlane 面组）的子句柄即面。
      if (kind === KIND_WIRE || kind === KIND_EDGE) return []
      const compKids = knownCompounds.get(s)
      if (compKids) {
        const faces = compKids.filter((k) => knownFaces.has(k))
        return faces.map((f) => faceFingerprint(kernel, f, hashUpperBound))
      }
      const faces = arr(kernel.getSolidFaces(s))
      const hashes = faces.map(f => faceFingerprint(kernel, f, hashUpperBound))
      // 登记 hash↔handle（fuseWithHistory 溯源对齐依赖此表）
      const reg = hashRegistry.get(kernel) ?? new Map<number, number>()
      faces.forEach((f, i) => reg.set(hashes[i], f))
      hashRegistry.set(kernel, reg)
      return hashes
    },
    hashCode(shape: BrepHandle, upperBound: number): number {
      // 类型由句柄标签决定（见文件头句柄桥接 GOTCHA）：brepkit 无法反查句柄类型，
      // 而面指纹与边指纹必须落在**互不相交**的取值域，否则 edgeGroups 的 hash 会
      // 命中面的指纹（实测：box 的 edge 0..5 句柄号与 face 0..5 相同）。
      // 生产端（faceMesh/solidMesh/compoundMesh → faceFingerprint；wireframe →
      // edgeFingerprint）与消费端（本函数）用同一组函数、同一个上界，查表才命中。
      const raw = asNum(shape)
      return kindOf(shape) === KIND_EDGE
        ? edgeFingerprint(kernel, raw, upperBound)
        : faceFingerprint(kernel, raw, upperBound)
    },
    isSame(a: BrepHandle, b: BrepHandle): boolean {
      // 裸句柄号相同还不够：brepkit 的 face 3 与 edge 3 是**两个不同的形**。
      // 两侧都带标签时必须同类型；任一侧无标签（历史调用方）时退回纯数字比较，
      // 保证加标签不改变既有行为。
      if (asNum(a) !== asNum(b)) return false
      const ka = kindOf(a), kb = kindOf(b)
      return ka === kb || ka === KIND_SOLID || kb === KIND_SOLID
    },
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
      return arr(kernel.adjacentFaces(asNum(shape), asNum(face))).map(asFace)
    },
    sharedEdges(a: BrepHandle, b: BrepHandle): BrepHandle[] {
      return arr(kernel.sharedEdges(asNum(a), asNum(b))).map(asEdge)
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
    getNurbsCurveData(edge: BrepHandle): BrepNurbsCurveData | null {
      try {
        const p = JSON.parse(kernel.getNurbsCurveData(asNum(edge))) as {
          degree?: number
          periodic?: boolean
          rational?: boolean
          knots?: number[]
          multiplicities?: number[]
          poles?: number[]
          weights?: number[]
        }
        if (p && typeof p.degree === 'number') {
          return {
            degree: p.degree,
            periodic: !!p.periodic,
            rational: !!p.rational,
            knots: (p.knots ?? []).map(Number),
            multiplicities: (p.multiplicities ?? []).map(Number),
            poles: (p.poles ?? []).map(Number),
            weights: (p.weights ?? []).map(Number),
          }
        }
      } catch { /* 非 Nurbs 边 */ }
      return null
    },
    curveSplit(edge: BrepHandle, param: number): [BrepHandle, BrepHandle] {
      // brepkit 原生返回 Uint32Array 两元素（occt 返回 [ShapeHandle, ShapeHandle]）——
      // 适配器统一为二元组。两个碎片都必须登记进 knownEdges，否则下游 meshShape 分发不到。
      const parts = kernel.curveSplit(asNum(edge), param)
      if (parts.length !== 2) fail(`curveSplit: expected 2 edges, got ${parts.length}`)
      const a = parts[0]!
      const b = parts[1]!
      knownEdges.add(a)
      knownEdges.add(b)
      return [asEdge(a), asEdge(b)]
    },
    interpolatePoints(points: BrepVec3[], degree: number): BrepHandle {
      // GOTCHA：interpolatePoints 返回 **edge** 句柄（不是 wire）——wire.ts smooth 路径把它
      // 直接当 wire 送 solidToShape。登记进 knownEdges，meshShape 才能走 tessellateEdge 路径。
      const e = kernel.interpolatePoints(flattenPoints(points), degree)
      knownEdges.add(e)
      return asEdge(e)
    },
    defeature(shape: BrepHandle, faces: BrepHandle[]): BrepHandle {
      return asHandle(markSolid(kernel.defeature(asNum(shape), Uint32Array.from(faces.map(asNum)))))
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
      // removeHolesFromFace 返回**新 face 句柄**（去掉内孔的同曲面 face），必须登记进 knownFaces。
      const f = kernel.removeHolesFromFace(asNum(face))
      knownFaces.add(f)
      return asFace(f)
    },
    reverseShape(shape: BrepHandle): BrepHandle {
      return withKind(kindOf(shape), kernel.reverseShape(asNum(shape)))
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
      const s = asNum(shape)
      const bboxFromPoints = (pts: ArrayLike<number>): BrepBoundingBox => {
        let xmin = Infinity, ymin = Infinity, zmin = Infinity, xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
        for (let i = 0; i + 2 < pts.length; i += 3) {
          xmin = Math.min(xmin, pts[i]!); ymin = Math.min(ymin, pts[i + 1]!); zmin = Math.min(zmin, pts[i + 2]!)
          xmax = Math.max(xmax, pts[i]!); ymax = Math.max(ymax, pts[i + 1]!); zmax = Math.max(zmax, pts[i + 2]!)
        }
        if (!Number.isFinite(xmin)) { xmin = ymin = zmin = 0; xmax = ymax = zmax = 0 }
        return { xmin, ymin, zmin, xmax, ymax, zmax }
      }
      const solidBbox = (h: number): BrepBoundingBox => {
        const b = kernel.boundingBox(h) as ArrayLike<number>
        return { xmin: b[0]!, ymin: b[1]!, zmin: b[2]!, xmax: b[3]!, ymax: b[4]!, zmax: b[5]! }
      }
      const kids = knownCompounds.get(s)
      if (kids) {
        let xmin = Infinity, ymin = Infinity, zmin = Infinity, xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
        for (const k of kids) {
          try {
            let b: BrepBoundingBox
            if (knownFaces.has(k)) b = bboxFromPoints(arr(kernel.tessellateFace(k, 0.1, 1).positions))
            else if (knownWires.has(k)) b = bboxFromPoints(arr(kernel.getWireEdges(k)).flatMap((e) => arr(kernel.tessellateEdge(e, 16))))
            else if (knownEdges.has(k)) b = bboxFromPoints(arr(kernel.tessellateEdge(k, 16)))
            else b = solidBbox(k)
            xmin = Math.min(xmin, b.xmin); ymin = Math.min(ymin, b.ymin); zmin = Math.min(zmin, b.zmin)
            xmax = Math.max(xmax, b.xmax); ymax = Math.max(ymax, b.ymax); zmax = Math.max(zmax, b.zmax)
          } catch { /* 子项 bbox 查询失败忽略 */ }
        }
        if (!Number.isFinite(xmin)) { xmin = ymin = zmin = 0; xmax = ymax = zmax = 0 }
        return { xmin, ymin, zmin, xmax, ymax, zmax }
      }
      // GOTCHA：kernel.boundingBox 是 solid-only。face/wire/edge 句柄必须走 tessellation 采样，
      // 否则 measure() 对 wire/profile 调 getBoundingBox 即崩 "invalid solid handle"。
      const kind = resolveKind(shape, s)
      if (kind === KIND_FACE) return bboxFromPoints(arr(kernel.tessellateFace(s, 0.1, 1).positions))
      if (kind === KIND_WIRE) return bboxFromPoints(arr(kernel.getWireEdges(s)).flatMap((e) => arr(kernel.tessellateEdge(e, 16))))
      if (kind === KIND_EDGE) return bboxFromPoints(arr(kernel.tessellateEdge(s, 16)))
      return solidBbox(s)
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
      // 唯一 edge 弧长之和（与 occt 适配器同口径，D5）。
      // 旧实现用 `try { getEdgeCurveType } catch { wireLength }` 判别入参差异，但
      // getEdgeCurveType 对 solid / face / wire **也不抛错**，于是统一走 edgeLength，
      // 返回「首条边」长度——值随构建历史漂移（盒 20 vs 10；两边的 wire 真长 15 却给 20），
      // 且与 occt 的 Σ 面周长（280）不同口径。改为按 topo 去重枚举边后求和。
      let total = 0
      for (const e of api.getSubShapes(shape, 'edge')) total += api.curveLength(e)
      return total
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
      const c = markSolid(kernel.copySolid(asNum(shape)))
      kernel.fixFaceOrientations(c)
      return asHandle(c)
    },
    removeDegenerateEdges(shape: BrepHandle, tolerance?: number): BrepHandle {
      const c = markSolid(kernel.copySolid(asNum(shape)))
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
      const c = solids.length === 1 ? solids[0] : kernel.makeCompound(Uint32Array.from(solids))
      if (solids.length > 1) knownCompounds.set(c, solids)
      return asHandle(markSolid(c))
    },
    exportStep(shape: BrepHandle): string {
      // brepkit exportStep 返回 UTF-8 字节（Uint8Array），需解码为 STEP 文本（2026-09-19 实测）
      const bytes = kernel.exportStep(asNum(shape))
      return typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)
    },
    importStl(data: string | ArrayBuffer): BrepHandle {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
      return asHandle(markSolid(kernel.importStl(bytes)))
    },
    fromBREP(data: string): BrepHandle {
      // ⚠️ brepkit fromBREP 吃字符串（STEP 文本或 toBREP/toBrepJson 输出，内核自动判别），
      // 与 serializeSolid/deserializeSolid 的**二进制 arena** 是两套机制。
      // 旧实现误用 `deserializeSolid(atob(data))`：base64 解码破坏了 STEP 文本 → 往返必失败
      // （2026-09-25 实证：fromBREP(STEP)、fromBREP(toBREP)、fromBREP(toBrepJson) 均成功）。
      return asHandle(markSolid(kernel.fromBREP(data)))
    },

    // ── 网格实体原语（方案 2026-10-01 §3.3；内核私有，不在 L1 契约面） ──
    // 规范构造顺序**不可交换**：importMesh → weld → unify。
    // 实测（brepkit-kernel/mesh-solid-topology.test.ts）：先 unify 后 weld 会把实体做坏
    // （体积归零、validate 非 0）。本对象只暴露原语，顺序由 `normalizeMeshSolid` 驱动。
    meshSolid: {
      importMesh(positions: Float32Array, indices: Uint32Array): BrepHandle {
        // 方言：importIndexedMesh 吃 **Float64Array**（坐标）+ **Uint32Array**（索引），
        // 返回裸 solid 号。逐三角形建面、顶点按坐标焊接、边不共享（不是真流形）。
        const coords = new Float64Array(positions.length)
        for (let i = 0; i < positions.length; i++) coords[i] = positions[i]!
        return asHandle(markSolid(kernel.importIndexedMesh(coords, indices)))
      },
      weld(faces: BrepHandle[], tolerance: number): BrepHandle {
        // weldShellsAndFaces 吃**裸面号数组**（Uint32Array），返回新 solid 号；
        // 把重复边缝成共享边 → 真流形（实测 10mm 立方体 36 边 → 18 边、validate 0）。
        return asHandle(markSolid(kernel.weldShellsAndFaces(
          Uint32Array.from(faces.map((f) => asNum(f))),
          tolerance,
        )))
      },
      unify(solid: BrepHandle): number {
        // GOTCHA：unifyFaces 是**原地修改**入参实体，返回值是**被合并掉的面数**
        // （不是新句柄）。写成 `const s = unify(...)` 会拿到一个落在合法句柄区间的
        // 数字，后续全部查询打在一个无关实体上且不报错。
        return Number(kernel.unifyFaces(asNum(solid)))
      },
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
  memoizedKernel = kernel
  memoizedPrimitives = api
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

/** 已构建的 L1 契约面对象（按内核实例 memo；见 createBrepkitPrimitives 的 GOTCHA）。 */
let memoizedPrimitives: BrepkitEngineExtras | null = null
let memoizedKernel: BrepKitKernel | null = null

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

/**
 * 释放内核单例（测试收尾用；宿主常驻不需调用）。
 *
 * GOTCHA（2026-10-01 修复）：旧实现只 `free()` 内核、**不重置** brepkitWasm.ts 里
 * 缓存的 `initPromise`，也不丢 memo 化的原语对象 → 第二次 `createBrepkitPrimitives()`
 * 拿到**已释放**的内核，随后一切内核调用报 `null pointer passed to rust`
 * （实测：`BrepKernel.makeBox`）。现在三样一起清：内核、initPromise、memo 原语。
 */
export function disposeBrepkit(): void {
  try {
    if (liveKernel?.free) liveKernel.free()
  } catch { /* 已释放 */ }
  liveKernel = null
  memoizedPrimitives = null
  memoizedKernel = null
  resetBrepkitWasm()
}

/** brepkit 适配器原语集类型（BrepEngineApi + brepkit 专属诊断 getMeshFallbackCount）。 */
export type BrepkitPrimitives = Awaited<ReturnType<typeof createBrepkitPrimitives>>
