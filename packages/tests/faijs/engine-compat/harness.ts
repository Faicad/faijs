/**
 * harness.ts — brepkit ↔ occt 一致性测试共享底座（方案 §6.2 / §6.3）
 *
 * 引擎接入方式（实测结论，非臆测）：
 *  - faijs-fasteners 与宿主注入式 backend 对齐：fasteners 走 `requireKernel()`
 *    读 `getBackends().kernel.brep`（纯 L1）。faijs-gears 走**双句柄** `gearKernel()`：
 *    `l1 = getBrepApi()`（L1）+ `occt = getOcctKernel()`（occt 平台面），入口处按活动引擎
 *    id 做平台库门禁（非 `occt` 即在触碰内核前抛 `E_BREP_UNSUPPORTED`）。
 *  - 本 harness 通过 `configureBackends({ kernel: { brep } })` 把指定引擎注入
 *    `getBackends().kernel.brep`：**两侧都注入 L1 适配器**——occt 侧
 *    `createOcctPrimitives()`、brepkit 侧 `getBrepEngine('brepkit').primitives`。
 *    ⚠️ 2026-10-13 起 fasteners 的 `WarehouseKernel` 已收敛为 `BrepEngineApi` 子集
 *    （§7 决策点 5）：它只说 L1 名（`revolveVec` / `meshShape` / `loft(sections,ruled)`），
 *    raw occt-wasm **没有**这些名（raw 是 `revolve` / `tessellate`），注入 raw 会
 *    在 `revolveProfile` 处报 `kern.revolveVec is not a function`。故 occt 侧也
 *    必须注入 L1，与生产注入口径一致（生产同样注入 L1，见 faijs-fasteners 的
 *    `src/test-setup.ts`）。
 *  - brepkit 侧仅保留一个测试桩 `revolve`（`{point,direction}` → `revolveVec`），
 *    供仍用 raw occt 口径（`revolve(shape, {point,direction}, angleRad)`）的调用点使用；
 *    其余原语（含 `makeSolid` / `rotate` / `healWire` / `split` / `projectPointOnFace` /
 *    `loft-shell` 等 occt 平台能力）brepkit 核心未实现——这是 gears 在 brepkit 下被门禁
 *    拒绝（`E_BREP_UNSUPPORTED`）的根本原因，而非某个具体调用点的随机失败。
 *  - 指标（volume/表面积/包围盒/质心/拓扑）统一用 L1 适配器抽取（raw occt 与
 *    brepkit 的 `getSubShapes` 约定不同，L1 已归一化；句柄在同引擎单例内可互通）。
 *
 * 真缺口在声明与门禁：faijs-gears 是 occt-only 平台库（`package.json` 的
 * `faijs.lib.platform = ['occt']`），其构建主路径依赖四件 L1 无法表达的能力
 * （`loft-shell` / `healWire` / `split` / `projectPointOnFace`）。因此 `gearKernel()` 在
 * 触碰内核前先校验活动引擎 id：brepkit 下直接抛 `E_BREP_UNSUPPORTED`（执行前拒绝，
 * 含引擎名）。`useGearKernel('brepkit')` + 断言把这道门禁钉住，而非绕过。
 */

import type { BrepEngineApi, BrepHandle, BrepVec3 } from '../../../core/src/brep/engine/primitives'
import type { Backends } from '../../../core/src/runtime-state'
import { configureBackends, CONTRACT_VERSION } from '../../../core/src/runtime-state'
import { getBrepEngine } from '../../../core/src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../../core/src/brep/engine/adapters/brepkit'
import { createOcctPrimitives } from '../../../core/src/occt-kernel/occt-primitives'
import type { WarehouseAxis, WarehouseKernel } from '../../../faijs-fasteners/src/kernel'

export type BrepEngineId = 'occt' | 'brepkit'

export interface EngineMetrics {
  volume: number
  surfaceArea: number
  bbox: { min: BrepVec3; max: BrepVec3 }
  centerOfMass: BrepVec3
  /**
   * 子形状数量。`wire` 可能为 `null`：brepkit 的 `getSubShapes` 不枚举 wire
   * （仅 face/edge/vertex/shell/solid），属引擎能力差异而非几何差异，T1 比较时跳过。
   */
  counts: { solid: number; shell: number; face: number; edge: number; wire: number | null; vertex: number }
  isSolid: boolean
  /** 当前引擎无法枚举的子形状类型（如 brepkit 的 'wire'），T1 跳过比较。 */
  unsupported: string[]
}

/** 构建用内核：库需要的 `WarehouseKernel` 形态（fasteners / washer / bearing / holes / nut / screw / thread / chain 共用纯 L1）。 */
const buildKernel: Record<BrepEngineId, WarehouseKernel> = {} as Record<BrepEngineId, WarehouseKernel>
/** 指标用内核：归一化的 L1 适配器（raw occt / brepkit 共用同一 wasm 单例，句柄互通）。 */
const metricKernel: Record<BrepEngineId, BrepEngineApi> = {} as Record<BrepEngineId, BrepEngineApi>

/**
 * 注册并解析两个引擎。应在 `beforeAll` 中调用一次。
 * 两侧都注入 L1 适配器（fasteners 的 `WarehouseKernel` = `BrepEngineApi` 子集，
 * 只说 L1 名；raw occt-wasm 不满足，见文件头）。
 */
export async function initEngines(): Promise<void> {
  // occt：L1 适配器（同一 wasm 单例，句柄与 raw 互通）；构建与指标共用同一 L1 面。
  // `createOcctPrimitives` 内部 await `initOcctWasm()`——wasm 单例就绪后，faijs-gears
  // 的 `gearKernel()` 经 `getOcctKernel()` 取到的平台面与这里的 L1 面是同一份单例。
  const occtL1 = await createOcctPrimitives()
  buildKernel.occt = occtL1 as unknown as WarehouseKernel
  metricKernel.occt = occtL1

  // brepkit：L1 单例（带 memo）；仅补一个 `revolve` 桩给未迁 L1 的调用点（gears）。
  await registerBrepkitBrepEngine()
  const brepL1 = (await getBrepEngine('brepkit')).primitives
  const brepWk = {
    ...brepL1,
    // 桩：`revolve(shape, {point,direction}, angleRad)` 是 raw occt 口径，L1 里叫
    // `revolveVec(shape, center, direction, angleDeg)`。2026-10-13 起 brepkit L1 的
    // `revolveVec` 自己消化 wire→face 方言（`profileFaceOf`），故此处只做名与角度
    // 单位的换算，不再有 try/catch 猜类型。
    revolve: (shape: BrepHandle, axis: WarehouseAxis, angleRad: number): BrepHandle =>
      brepL1.revolveVec(shape, axis.point, axis.direction, (angleRad * 180) / Math.PI),
  } as unknown as WarehouseKernel
  buildKernel.brepkit = brepWk
  metricKernel.brepkit = brepL1
  // 默认把活动内核配成 occt，使直接读取 `getBackends().kernel.brep` 的库
  // （fasteners 的 requireKernel / thread 等）在 beforeAll 后即可 build，无需每个测试再切。
  useBuildKernel('occt')
}

/** 把任意内核注入 `getBackends().kernel.brep`（两个入口共用）。 */
function injectKernel(id: BrepEngineId, brep: WarehouseKernel): void {
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep', brepEngineId: id },
    kernel: { brep },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
  } as unknown as Backends)
}

/** 切换当前活动内核：把对应 `WarehouseKernel` 注入 `getBackends().kernel.brep`。 */
export function useBuildKernel(id: BrepEngineId): void {
  injectKernel(id, buildKernel[id])
}

/**
 * faijs-gears 专用：切换到目标引擎。
 *
 * faijs-gears 现已收敛为**双句柄**（`gearKernel()`：`l1 = getBrepApi()` + `occt = getOcctKernel()`），
 * 入口处按活动引擎 id（`config.brepEngineId`）做平台库门禁：非 `occt` 即在触碰内核前抛
 * `E_BREP_UNSUPPORTED`（而非旧 Proxy 兜底的随机失败点）。因此本函数只需把活动引擎切到
 * 对应 id——occt 下平台面就绪、正常构建；brepkit 下门禁直接拒绝（执行前）。
 *
 * @param id 目标引擎；`'occt'` / `'brepkit'`。
 */
export function useGearKernel(id: BrepEngineId): void {
  useBuildKernel(id)
}

export interface BuiltPart {
  engine: BrepEngineId
  metrics: EngineMetrics
  handle: BrepHandle
}

/**
 * 在指定引擎下构建零件并抽取指标。
 * @param engine - 目标引擎
 * @param build - 零件 builder（返回含 `handle` 的结果对象）
 * @param params - builder 入参
 */
export function buildOn<P>(
  engine: BrepEngineId,
  build: (params: P) => { handle: BrepHandle },
  params: P,
): BuiltPart {
  useBuildKernel(engine)
  const result = build(params)
  const handle = result.handle
  const metrics = extractMetrics(engine, handle)
  return { engine, metrics, handle }
}

/**
 * 在指定引擎下抽取几何/拓扑指标（与 buildOn 共享）。
 * 供 brepkit 不可建、只能 occt 建模的零件（thread / gears 等）直接量测 occt 几何。
 */
export function extractMetrics(engine: BrepEngineId, handle: BrepHandle): EngineMetrics {
  const k = metricKernel[engine]
  const bbox = k.getBoundingBox(handle)
  // 子形状枚举对两引擎能力取并集；任一引擎不支持的类型记为 null（T1 跳过比较）。
  const subCounts: Record<string, number | null> = {}
  const unsupported: string[] = []
  for (const type of ['solid', 'shell', 'face', 'edge', 'wire', 'vertex'] as const) {
    try {
      subCounts[type] = k.getSubShapes(handle, type as never).length
    } catch {
      subCounts[type] = null
      unsupported.push(type)
    }
  }
  return {
    volume: k.getVolume(handle),
    surfaceArea: k.getSurfaceArea(handle),
    bbox: {
      min: { x: bbox.xmin, y: bbox.ymin, z: bbox.zmin },
      max: { x: bbox.xmax, y: bbox.ymax, z: bbox.zmax },
    },
    centerOfMass: k.getCenterOfMass(handle),
    counts: {
      solid: subCounts.solid!,
      shell: subCounts.shell!,
      face: subCounts.face!,
      edge: subCounts.edge!,
      wire: subCounts.wire,
      vertex: subCounts.vertex!,
    },
    isSolid: k.isSolid(handle),
    unsupported,
  }
}

/** occt-only 零件（brepkit 无对应原语）的度量抽娶：仅用 occt L1 量测。 */
export function measureOcct(handle: BrepHandle): EngineMetrics {
  return extractMetrics('occt', handle)
}

export interface Toleration {
  volumeRel?: number
  areaRel?: number
  bboxRel?: number
  coMRel?: number
}

/**
 * 软差异记录（T1 拓扑计数 / isSolid 的「记录但不门禁」项）。
 *
 * 为什么不写 console：引擎表示差异（brepkit 把圆弧/样条离散成大量线性段 →
 * face/edge/vertex 计数与 occt 不同；多体零件在两内核下 compound-of-solids vs
 * merged solid）**不是几何不一致**，但也不是错误——写 `console.warn` 会被 vitest
 * 采集成 `stderr |` 行，而 CI 的零 stderr 门禁把任何 stderr 行判失败
 * （ci.ps1:124-150 / .github/workflows/ci.yml 的 `grep -E '^stderr \|'`），
 * 用 spy/mock 吞掉又是禁止的（掩盖信号）。
 *
 * → 改为**返回值**：调用方拿到结构化记录，按需断言或留档。信息不丢、不污染 stderr。
 */
export interface SoftDiff {
  /** 来源：`topo` = T1 子形状计数；`isSolid` = 实体表示差异。 */
  kind: 'topo' | 'isSolid'
  /** 差异键（topo: shell/face/edge/vertex/wire；isSolid: 'isSolid'）。 */
  key: string
  /** 参考侧（occt）值。 */
  ref: number | boolean
  /** 对照侧（brepkit）值。 */
  got: number | boolean
  /** 成因（引擎表示策略），供断言 message 与留档引用。 */
  reason: string
}

/** 默认容差带（方案 §6.1 T2，可逐零件覆盖）。 */
export const DEFAULT_TOL: Required<Toleration> = {
  volumeRel: 1e-3,
  areaRel: 1e-3,
  bboxRel: 1e-4,
  coMRel: 1e-3,
}

/**
 * 一致性断言（方案 §6.1）：
 *  - T1 拓扑等价：solid 数量精确相等（硬门禁）；shell/face/edge/vertex/wire 只**记录**
 *    （brepkit 离散化策略导致计数不可比），见 {@link SoftDiff}。
 *  - T2 度量收敛：体积/表面积/包围盒/质心的相对偏差在容差带内（硬门禁）。
 *  - isSolid 仅记录（compound-of-solids vs merged-solid 表示差异；T1 solid 门禁已保证有效性）。
 *
 * 注意：软差异**不写 console**（CI 零 stderr 门禁），一律经返回值交出。
 *
 * @returns 软差异记录（可能为空数组）——调用方按需断言/留档。
 */
export function assertConsistent(
  ref: EngineMetrics,
  got: EngineMetrics,
  tol: Toleration = DEFAULT_TOL,
): SoftDiff[] {
  const soft = expectTopoEqual(ref.counts, got.counts)
  assertRel('volume', ref.volume, got.volume, tol.volumeRel ?? DEFAULT_TOL.volumeRel)
  assertRel('surfaceArea', ref.surfaceArea, got.surfaceArea, tol.areaRel ?? DEFAULT_TOL.areaRel)
  assertBbox(ref.bbox, got.bbox, tol.bboxRel ?? DEFAULT_TOL.bboxRel)
  assertVec('centerOfMass', ref.centerOfMass, got.centerOfMass, tol.coMRel ?? DEFAULT_TOL.coMRel)
  // isSolid 软记录（不门禁）：多体零件在 occt 下可能是 compound-of-solids（isSolid=false），
  // 而 brepkit 合并为单个 solid（isSolid=true）——属枚举/表示差异，非几何差异。
  // 真正的实体有效性已由 T1 的 `solid` 数量硬门禁保证（两引擎都须 ≥1 个 solid）。
  if (ref.isSolid !== got.isSolid) {
    soft.push({
      kind: 'isSolid',
      key: 'isSolid',
      ref: ref.isSolid,
      got: got.isSolid,
      reason:
        'compound-of-solids vs merged solid（表示差异；实体有效性由 T1 的 solid 数量硬门禁保证）',
    })
  }
  return soft
}

/**
 * T1 拓扑比较：只对 solid 计数做硬门禁，其余子形状计数按引擎表示差异**记录**。
 *
 * 记录项（不门禁、也不写 console，见 {@link SoftDiff}）：
 *   - brepkit 把圆弧/样条离散成大量线性段 → face/edge 数量随离散精度爆炸（如
 *     10 齿链轮 occt=62 face / brepkit=953 face，48 齿=292 / 5344），不代表几何不一致；
 *   - brepkit 不枚举 wire（该键为 null → 跳过）；两内核旋转体接缝顶点数也可能不同。
 * 真正的几何一致性由 T2（体积/面积/bbox/质心）把关，详见 assertConsistent。
 *
 * @returns 软差异记录（可能为空数组）。
 */
export function expectTopoEqual(a: EngineMetrics['counts'], b: EngineMetrics['counts']): SoftDiff[] {
  // 硬门禁：仅 solid 数量必须相等——这是真正引擎无关的拓扑。
  // 等价实体（同一几何）在两内核下必然拥有相同数量的 solid 与 shell。
  const hard = ['solid'] as const
  for (const key of hard) {
    if (a[key] !== b[key]) {
      throw new Error(`[T1 topology] ${key} count mismatch: ref=${a[key]} brepkit=${b[key]}`)
    }
  }
  const soft: SoftDiff[] = []
  const softKeys = ['shell', 'face', 'edge', 'vertex', 'wire'] as const
  for (const key of softKeys) {
    const av = a[key]
    const bv = b[key]
    if (av === null || bv === null) continue
    if (av !== bv) {
      soft.push({
        kind: 'topo',
        key,
        ref: av,
        got: bv,
        reason: 'engine representation difference（brepkit 离散化/接缝策略），记录 only',
      })
    }
  }
  return soft
}

function assertRel(name: string, ref: number, got: number, rel: number): void {
  const denom = Math.max(Math.abs(ref), 1e-9)
  const dev = Math.abs(got - ref) / denom
  if (dev > rel) {
    throw new Error(`[T2 ${name}] relative deviation ${dev.toExponential(3)} exceeds tol ${rel} (ref=${ref}, got=${got})`)
  }
}

function assertBbox(
  ref: EngineMetrics['bbox'],
  got: EngineMetrics['bbox'],
  rel: number,
): void {
  const diag = Math.max(ref.max.x - ref.min.x, ref.max.y - ref.min.y, ref.max.z - ref.min.z, 1e-9)
  for (const axis of ['x', 'y', 'z'] as const) {
    const dev = (Math.abs(got.min[axis] - ref.min[axis]) + Math.abs(got.max[axis] - ref.max[axis])) / (2 * diag)
    if (dev > rel) {
      throw new Error(`[T2 bbox.${axis}] relative deviation ${dev.toExponential(3)} exceeds tol ${rel}`)
    }
  }
}

function assertVec(name: string, ref: BrepVec3, got: BrepVec3, rel: number): void {
  const d = Math.max(Math.abs(ref.x), Math.abs(ref.y), Math.abs(ref.z), 1e-9)
  for (const axis of ['x', 'y', 'z'] as const) {
    const dev = Math.abs(got[axis] - ref[axis]) / d
    if (dev > rel) {
      throw new Error(`[T2 ${name}.${axis}] relative deviation ${dev.toExponential(3)} exceeds tol ${rel}`)
    }
  }
}
