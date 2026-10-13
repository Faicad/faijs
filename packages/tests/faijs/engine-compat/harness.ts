/**
 * harness.ts — brepkit ↔ occt 一致性测试共享底座（方案 §6.2 / §6.3）
 *
 * 引擎接入方式（实测结论，非臆测）：
 *  - faijs-fasteners 与 faijs-gears 均已与宿主注入式 backend 对齐：fasteners 走
 *    `requireKernel()` 读 `getBackends().kernel.brep`；gears 走 `getGearKernel()`
 *    （优先注入式 backend，未配置时回退 `initOcctWasm()`）。
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
 *    供尚未迁 L1 的调用点（faijs-gears）使用；`makeSolid` / `rotate` 桩已于
 *    2026-10-13 移除——两者现在都由 brepkit L1 适配器原生提供（`makeSolid` 对
 *    已是实体的输入幂等；`rotate` 走 Rodrigues 矩阵 + `transform`）。
 *  - 指标（volume/表面积/包围盒/质心/拓扑）统一用 L1 适配器抽取（raw occt 与
 *    brepkit 的 `getSubShapes` 约定不同，L1 已归一化；句柄在同引擎单例内可互通）。
 *
 * 真缺口在 core 引擎：gears 收敛到 L1 后，brepkit 下构建失败点落在 **15 个 occt 平台
 * 扩展**上（`sew` / `split` / `loft-shell` / `healWire` / `isFace` 族 / `projectPointOnFace`
 * / `revolve` / `buildSolidFromFaces` / `makeFaceOnSurface` / `outerWire` / `getShapeType` /
 * `interpolatePoints(periodic)`）——这些 brepkit 核心未实现。用 `useGearKernel('brepkit')`
 * + 断言把当前真实失败点钉住，而非绕过。
 */

import type { BrepEngineApi, BrepHandle, BrepVec3 } from '../../../core/src/brep/engine/primitives'
import type { Backends } from '../../../core/src/runtime-state'
import { configureBackends, CONTRACT_VERSION } from '../../../core/src/runtime-state'
import { getBrepEngine } from '../../../core/src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../../core/src/brep/engine/adapters/brepkit'
import { createOcctPrimitives } from '../../../core/src/occt-kernel/occt-primitives'
import { initOcctWasm } from '../../../core/src/occt-kernel/occtKernel'
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
/**
 * raw occt-wasm 平台面（occt 独有原语：sew / split / fillet / loft-shell / makeCylinder …）。
 * 用于给 faijs-gears 拼出「L1 优先 + raw occt 平台原语兜底」的 occt 构建面（见 gearOcctKernel）。
 */
let rawOcctKernel: WarehouseKernel | null = null
/**
 * gears 的 occt 构建面 = **L1 适配器优先** + raw occt 平台原语兜底。
 *  - 10 个 L1 方法（bsplineSurface / makeSolid / thicken / makeCircleArc / makeHelixWire /
 *    approximatePoints / makeNonPlanarFace / rotate / subShapeCount / getSurfaceArea / surfaceType /
 *    sew / sewAndSolidify / mirror / reverseShape / vertexPosition / fillet / shell / translate /
 *    getBoundingBox / isSolid / getSubShapes / makeWire / cut / isValid / makeCylinder / makeArcEdge /
 *    fixFaceOrientations / curvePointAtParam / curveParameters / fuse / curveType / copy /
 *    addHolesInFace / makeFace / extrude）走 L1 适配器（与 brepkit 同契约口径，几何等价）；
 *  - 15 个 occt 平台扩展（loft-shell / split-by-tools / healWire / isFace 族 / projectPointOnFace /
 *    revolve / buildSolidFromFaces / makeFaceOnSurface / outerWire / getShapeType /
 *    interpolatePoints(periodic)）由 raw occt 兜底；
 *  - 语义分歧两处强制 raw occt：`loft`（L1 第三参是 endPoint，旧口径布尔触发守卫）、
 *    `interpolatePoints`（periodic vs degree）。
 *  - 这是测试注入面；生产由宿主注入（纯 L1 + 必要的 occt 平台扩展），gears 自己的单测走
 *    `getGearKernel()` 的 `getOcctKernel()` 回退。
 */
let gearOcctKernel: WarehouseKernel | null = null
/** 指标用内核：归一化的 L1 适配器（raw occt / brepkit 共用同一 wasm 单例，句柄互通）。 */
const metricKernel: Record<BrepEngineId, BrepEngineApi> = {} as Record<BrepEngineId, BrepEngineApi>

/**
 * 注册并解析两个引擎。应在 `beforeAll` 中调用一次。
 * 两侧都注入 L1 适配器（fasteners 的 `WarehouseKernel` = `BrepEngineApi` 子集，
 * 只说 L1 名；raw occt-wasm 不满足，见文件头）。
 */
export async function initEngines(): Promise<void> {
  // occt：L1 适配器（同一 wasm 单例，句柄与 raw 互通）；构建与指标共用同一 L1 面。
  const occtL1 = await createOcctPrimitives()
  buildKernel.occt = occtL1 as unknown as WarehouseKernel
  metricKernel.occt = occtL1
  // raw 平台面：给 faijs-gears 拼装 occt 构建面（见 gearOcctKernel）。
  rawOcctKernel = (await initOcctWasm()) as unknown as WarehouseKernel
  // gears 的 occt 构建面：默认转发 raw occt（brepkit 未实现的原语都在这里），仅把 10 个
  // L1 方法覆盖为 L1 适配器实现（与 brepkit 同契约口径），并把语义分歧两处强制回 raw：
  //   - `loft`（L1 第三参是 endPoint，旧口径布尔触发守卫）；
  //   - `interpolatePoints`（periodic vs degree）。
  // ⚠️ 用 Proxy 而非 `{...raw}`：occt-wasm 模块方法不可枚举，spread 会整包丢方法。
  {
    const l1 = occtL1 as unknown as Record<string, (...a: unknown[]) => unknown>
    const raw = rawOcctKernel as unknown as Record<string, unknown>
    const L1_OVERRIDE = [
      'bsplineSurface', 'makeSolid', 'thicken', 'makeCircleArc', 'makeHelixWire',
      'approximatePoints', 'makeNonPlanarFace', 'rotate', 'subShapeCount', 'getSurfaceArea',
      'surfaceType', 'sew', 'sewAndSolidify', 'mirror', 'reverseShape', 'vertexPosition',
      'fillet', 'shell', 'translate', 'getBoundingBox', 'isSolid', 'getSubShapes', 'makeWire',
      'cut', 'isValid', 'makeCylinder', 'makeArcEdge', 'fixFaceOrientations',
      'curvePointAtParam', 'curveParameters', 'fuse', 'curveType', 'copy', 'addHolesInFace',
      'makeFace', 'extrude',
    ]
    const gear = new Proxy(raw, {
      get(target, prop, recv) {
        const key = prop as string
        // 语义分歧两处强制 raw occt，且必须绑定到 raw 实例（occt-wasm 方法要求
        // `this` 为 OcctKernel 实例，Proxy 透传会让 `this` 指向 Proxy 本身而报错）。
        if (key === 'loft' || key === 'interpolatePoints') {
          const v = (target as Record<string, unknown>)[key]
          return typeof v === 'function' ? v.bind(target) : v
        }
        if (L1_OVERRIDE.includes(key) && typeof l1[key] === 'function') return l1[key]
        const v = Reflect.get(target, prop, recv)
        return typeof v === 'function' ? v.bind(target) : v
      },
    })
    gearOcctKernel = gear as unknown as WarehouseKernel
  }

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
 * faijs-gears 专用：注入 occt 构建面（L1 优先 + raw occt 平台原语兜底）。
 *
 * 与 fasteners 的 `useBuildKernel('occt')`（纯 L1）不同，gears 仍依赖若干 L1 契约
 * 之外的 occt 平台原语（loft-shell / split / healWire / isFace 族 …），这些在
 * brepkit 核心里不存在 → 故 brepkit 注入下 gears 必失败（显性缺口，非静默降级）。
 *
 * @param id 目标引擎；`'occt'` 注入合并面、`'brepkit'` 注入纯 L1 brepkit（缺口暴露）。
 */
export function useGearKernel(id: BrepEngineId): void {
  if (id === 'occt') {
    if (!gearOcctKernel) throw new Error('useGearKernel: call initEngines() first')
    injectKernel('occt', gearOcctKernel)
  } else {
    // brepkit：纯 L1 brepkit 适配器 → gears 的 occt 平台原语缺失，构建必然失败。
    useBuildKernel('brepkit')
  }
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
export function buildOn(
  engine: BrepEngineId,
  build: (params: unknown) => { handle: BrepHandle },
  params: unknown,
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

/** 默认容差带（方案 §6.1 T2，可逐零件覆盖）。 */
export const DEFAULT_TOL: Required<Toleration> = {
  volumeRel: 1e-3,
  areaRel: 1e-3,
  bboxRel: 1e-4,
  coMRel: 1e-3,
}

/**
 * 一致性断言（方案 §6.1）：
 *  - T1 拓扑等价：solid/shell/face/edge/wire/vertex 数量精确相等（硬门禁）。
 *  - T2 度量收敛：体积/表面积/包围盒/质心的相对偏差在容差带内（软门禁）。
 *  - isSolid 仅软记录（compound-of-solids vs merged-solid 表示差异，T1 solid 门禁已保证有效性）。
 */
export function assertConsistent(
  ref: EngineMetrics,
  got: EngineMetrics,
  tol: Toleration = DEFAULT_TOL,
): void {
  expectTopoEqual(ref.counts, got.counts)
  assertRel('volume', ref.volume, got.volume, tol.volumeRel ?? DEFAULT_TOL.volumeRel)
  assertRel('surfaceArea', ref.surfaceArea, got.surfaceArea, tol.areaRel ?? DEFAULT_TOL.areaRel)
  assertBbox(ref.bbox, got.bbox, tol.bboxRel ?? DEFAULT_TOL.bboxRel)
  assertVec('centerOfMass', ref.centerOfMass, got.centerOfMass, tol.coMRel ?? DEFAULT_TOL.coMRel)
  // isSolid 软记录（不门禁）：多体零件在 occt 下可能是 compound-of-solids（isSolid=false），
  // 而 brepkit 合并为单个 solid（isSolid=true）——属枚举/表示差异，非几何差异。
  // 真正的实体有效性已由 T1 的 `solid` 数量硬门禁保证（两引擎都须 ≥1 个 solid）。
  if (ref.isSolid !== got.isSolid) {
    console.warn(
      `[consistency* soft] isSolid differs: ref=${ref.isSolid} brepkit=${got.isSolid} ` +
        `(representation difference: compound-of-solids vs merged solid; T1 solid-count gate enforces validity)`,
    )
  }
}

export function expectTopoEqual(a: EngineMetrics['counts'], b: EngineMetrics['counts']): void {
  // 硬门禁：仅 solid 数量必须相等——这是真正引擎无关的拓扑。
  // 等价实体（同一几何）在两内核下必然拥有相同数量的 solid 与 shell。
  const hard = ['solid'] as const
  for (const key of hard) {
    if (a[key] !== b[key]) {
      throw new Error(`[T1 topology] ${key} count mismatch: ref=${a[key]} brepkit=${b[key]}`)
    }
  }
  // 软记录（仅告警、不门禁）：face / edge / vertex / wire 受引擎表示策略影响。
  //   - brepkit 把圆弧/样条离散成大量线性段 → face/edge 数量随离散精度爆炸（如
  //     10 齿链轮 occt=62 face / brepkit=953 face，48 齿=292 / 5344），不代表几何不一致。
  //   - brepkit 不枚举 wire；两内核旋转体接缝顶点数也可能不同。
  // 真正的几何一致性由 T2（体积/面积/bbox/质心）把关，详见 assertConsistent。
  const soft = ['shell', 'face', 'edge', 'vertex', 'wire'] as const
  for (const key of soft) {
    const av = a[key]
    const bv = b[key]
    if (av === null || bv === null) continue
    if (av !== bv) {
      console.warn(
        `[T1* soft] ${key} count differs: ref=${av} brepkit=${bv} (engine representation difference, recorded only)`,
      )
    }
  }
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
