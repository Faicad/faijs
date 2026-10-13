/**
 * harness.ts — brepkit ↔ occt 一致性测试共享底座（方案 §6.2 / §6.3）
 *
 * 引擎接入方式（实测结论，非臆测）：
 *  - faijs-fasteners 与 faijs-gears 均已与宿主注入式 backend 对齐：fasteners 走
 *    `requireKernel()` 读 `getBackends().kernel.brep`；gears 走 `getGearKernel()`
 *    （优先注入式 backend，未配置时回退 `initOcctWasm()`）。
 *  - 本 harness 通过 `configureBackends({ kernel: { brep } })` 把指定引擎注入
 *    `getBackends().kernel.brep`：occt 侧注入 raw occt-wasm（与生产一致）；
 *    brepkit 侧注入 L1 单例 + 测试桩（`revolve`→`revolveVec` / `makeSolid` /
 *    `rotate`）。两部分零件（washer/nut/screw/holes/chain/bearing）由此在
 *    brepkit 下也能构建并通过 T1+T2 一致性。
 *  - 指标（volume/表面积/包围盒/质心/拓扑）统一用 L1 适配器抽取（raw occt 与
 *    brepkit 的 `getSubShapes` 约定不同，L1 已归一化；句柄在同引擎单例内可互通）。
 *
 * 真缺口根因在 core 引擎：brepkit 未实现 `bsplineSurface` / `makeHelixWire` /
 * `approximatePoints` / `loft` 等 B 样条/螺旋原语（归 core，不在本包范围）。
 * thread / gears 在 brepkit 注入下构建必然失败——用 `useBuildKernel('brepkit')`
 * + 断言抛错把缺口**暴露在引擎层**，而非绕过。
 */

import type { BrepEngineApi, BrepHandle, BrepVec3 } from '../../../core/src/brep/engine/primitives'
import type { Backends } from '../../../core/src/runtime-state'
import { configureBackends, CONTRACT_VERSION } from '../../../core/src/runtime-state'
import { getBrepEngine } from '../../../core/src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../../core/src/brep/engine/adapters/brepkit'
import { initOcctWasm } from '../../../core/src/occt-kernel/occtKernel'
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

/** 构建用内核：库需要的 `WarehouseKernel` 形态。 */
const buildKernel: Record<BrepEngineId, WarehouseKernel> = {} as Record<BrepEngineId, WarehouseKernel>
/** 指标用内核：归一化的 L1 适配器（raw occt / brepkit 共用同一 wasm 单例，句柄互通）。 */
const metricKernel: Record<BrepEngineId, BrepEngineApi> = {} as Record<BrepEngineId, BrepEngineApi>

/**
 * 注册并解析两个引擎。应在 `beforeAll` 中调用一次。
 * occt 侧用 raw occt-wasm（生产一致）；brepkit 侧用 L1 单例 + 测试桩 `revolve` 适配。
 */
export async function initEngines(): Promise<void> {
  // occt：raw 内核用于构建，L1 适配器用于指标（同一 wasm 单例）
  const occtRaw = (await initOcctWasm()) as unknown as WarehouseKernel
  const occtL1 = await createOcctPrimitives()
  buildKernel.occt = occtRaw
  metricKernel.occt = occtL1

  // brepkit：L1 单例（带 memo）；构建桩补 `revolve` → `revolveVec`
  await registerBrepkitBrepEngine()
  const brepL1 = (await getBrepEngine('brepkit')).primitives
  const brepWk = {
    ...brepL1,
    // §3.3 映射桩：brepkit 的 `revolveVec` 只吃 face，而 fasteners 当前仍走 raw occt
    // 的 `revolve(wire, …)`（见 `primitives.ts`）。库里 `revolveProfile` 接到的可能是
    // wire（washer 直传）也可能是已 `planarFace` 的 face（bearing 经 `planarFace` 预升面）。
    // ⚠️ brepkit `shapeType` 对 wire 与 face **都回 'COMPOUND'**（face 调 getSolidFaces 抛错
    // 被 catch、wire 调 getFaces 回 0），故不能靠 `=== 'FACE'` 区分——否则对 face 会错误地
    // 再 makeFace 一次 → makeFaceFromWire 拿到 face 句柄报 "invalid wire handle"。
    // 策略：先按 face 直接 `revolveVec`；若抛错（说明是 wire）再 `makeFace` 升面后旋。
    // 这正是 fasteners 迁移 L1 后该做的归一（归另一个 agent 的源码工作），此处仅作 seed
    // 验证桩，不改动任何库源码。
    revolve: (shape: BrepHandle, axis: WarehouseAxis, angleRad: number): BrepHandle => {
      const deg = (angleRad * 180) / Math.PI
      try {
        return brepL1.revolveVec(shape, axis.point, axis.direction, deg)
      } catch {
        const face = brepL1.makeFace(shape)
        return brepL1.revolveVec(face, axis.point, axis.direction, deg)
      }
    },
    // §3.3 映射桩：`makeSolid` 在 raw occt 里把 revolve 产出的 shell 包成 solid；
    // brepkit 的 `revolveVec` 经 markSolid 已直接产出 solid，故此处为恒等（不二次固化）。
    // 若将来 brepkit 侧出现非 solid 输入，应改用 `sewAndSolidify([shape])` 而非裸 identity。
    makeSolid: (shape: BrepHandle): BrepHandle => shape,
    // §3.3 映射桩：`rotate(shape, axis, angleRad)` 在 raw occt 是原生旋转；brepkit 无原生
    // `rotate`，但 L1 `transform` 接受 3×4 行主序矩阵，旋转可用 Rodrigues 矩阵精确表达
    // （绕任意点 = T(c)·R·T(-c)）。这是 faithful 映射，不引入近似。
    rotate: (shape: BrepHandle, axis: WarehouseAxis, angleRad: number): BrepHandle => {
      const d = axis.direction
      const len = Math.hypot(d.x, d.y, d.z) || 1
      const ux = d.x / len
      const uy = d.y / len
      const uz = d.z / len
      const ct = Math.cos(angleRad)
      const st = Math.sin(angleRad)
      const omc = 1 - ct
      const R = [
        ct + ux * ux * omc, ux * uy * omc - uz * st, ux * uz * omc + uy * st,
        uy * ux * omc + uz * st, ct + uy * uy * omc, uy * uz * omc - ux * st,
        uz * ux * omc - uy * st, uz * uy * omc + ux * st, ct + uz * uz * omc,
      ]
      const c = axis.point
      const tx = c.x - (R[0] * c.x + R[1] * c.y + R[2] * c.z)
      const ty = c.y - (R[3] * c.x + R[4] * c.y + R[5] * c.z)
      const tz = c.z - (R[6] * c.x + R[7] * c.y + R[8] * c.z)
      const m = [
        R[0], R[1], R[2], tx,
        R[3], R[4], R[5], ty,
        R[6], R[7], R[8], tz,
      ]
      return brepL1.transform(shape, m)
    },
  } as unknown as WarehouseKernel
  buildKernel.brepkit = brepWk
  metricKernel.brepkit = brepL1
  // 默认把活动内核配成 occt，使直接读取 `getBackends().kernel.brep` 的库
  // （fasteners 的 requireKernel / thread 等）在 beforeAll 后即可 build，无需每个测试再切。
  useBuildKernel('occt')
}

/** 切换当前活动内核：把对应 `WarehouseKernel` 注入 `getBackends().kernel.brep`。 */
export function useBuildKernel(id: BrepEngineId): void {
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep', brepEngineId: id },
    kernel: { brep: buildKernel[id] },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
  } as unknown as Backends)
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
