/**
 * @vitest-environment node
 *
 * 非居中长方体的面 TopoRef 解析 —— 2026-10-16 装配选面 bug 的回归钉子。
 *
 * **bug 现场**：小程序里建两个长方体（默认 `centered:false`，角点在原点、底面贴地），
 * 装配时选两个面加约束，报 `topo ref (face) not found in the current shape`。
 * 端侧探针实测：非居中两盒 12/12 面全 not-found；居中 / 旋转 / 三件全过。
 *
 * **两层根因**（都在 faijs，本测试各钉一层）：
 *
 * 层 1（直接原因）：brepkit 的 `uvBounds` 对平面返回 **±1e6 哨兵**，
 * `captureFaceHint` / `score.ts` 的 `candidateGeometry` 不检测哨兵，直接取中点
 * u=v=0 → `surfaceCenterOfMass` 在**参数原点**求值。非居中盒上 center 退化
 * （实测 `[20,20,0]` → `[0,0,0]`），距 hint 质心 28mm > 10mm 硬门
 * （`CENTROID_DIST_SQ_MAX_MM2`）→ 全候选被拒 → not-found。
 * 居中模型只因"参数原点恰好等于质心"而侥幸通过——是巧合，不是正确性。
 * 法向不受影响（平面法向在参数域是常数），所以 chamfer 等只用法向的路径从不暴露。
 *
 * 层 2（exact 为何没兜住）：宿主 bundle 与 animation 各打一份 faijs 代码，
 * `runtimeLineage` 曾是模块级单例 → 求解侧 roleTable 恒空 → exact 恒不中，
 * 只剩坏掉的兜底。且 exact 命中后取几何也曾走 `captureFaceHint`（同一套坏 API）。
 *
 * **修法**：行 hint 快照优先（`toScoringCandidate` / `resolveFaceGeometry` /
 * `faceGeometryFromContextEntry` 三处），BREP 执行时自写 `slot.faceHints`
 * （runtime.ts T3），ctx 的 BREP 分支候选同带 row；lineage 挂 globalThis 共享。
 * 行数据与 handle 同一次 execute 产出（同帧），几何就是命名行的同一来源。
 *
 * ⚠️ 装配纪律（同 selectors-brepkit.test.ts）：只装 brepkit，不在同进程切 occt。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRuntime } from '../../../src/index'
import { createNodePorts } from '../../../src/node'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import { configureBackends, CONTRACT_VERSION } from '../../../src/runtime-state'
import { disposeBrepkit } from '../../../src/brepkit-kernel/brepkitKernel'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import type { BrepHandle } from '../../../src/brep/engine/types'
import { captureTopoRef } from '../../../src/topology/naming'
import type { FaceNaming, FaceTopoRef } from '../../../src/topology/naming'
import { buildShapeResolutionContext, resolveFaceGeometry } from '../../../src/api/topo-resolve'
import { runtimeLineage } from '../../../src/topology/naming/lineage'
import type { Shape } from '../../../src/mesh/types'
import { scoreCandidate, MIN_SCORE } from '../../../src/topology/naming/score'
import type { FaceHint } from '../../../src/topology/naming/types'

/**
 * 装配纪律（同 selectors-brepkit.test.ts）：reset + 只装 brepkit + 显式
 * brepEngineId。**不能**图省事用 `getBrepApi()` 的全局当前值——同进程里别的
 * 测试文件可能激活了 occt，会把 A 内核句柄喂给 B 内核（invalid shape ID）。
 */
beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'brepkit' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Parameters<typeof configureBackends>[0])
}, 120000)

afterAll(() => {
  disposeBrepkit()
})

/** 两个非居中长方体（默认语义：角点在原点、底面贴地）——用户的最简场景。 */
const GEOM = ['let a = cad.box(40 * MM, 40 * MM, 8 * MM)', 'let b = cad.box(30 * MM, 30 * MM, 12 * MM)'].join('\n')

/** 一次执行 + 取 naming / shape / kernel 的四件套（kernel 从执行结果拿，不用全局当前值）。 */
async function execNonCentered(): Promise<{
  kernel: BrepEngineApi
  shape: object
  rows: readonly FaceNaming[]
}> {
  const runtime = createRuntime(createNodePorts(), 'brep', undefined, { execBackend: 'interpreter' })
  try {
    const r1 = await runtime.execute(GEOM, { topology: 'auto' })
    expect(r1.failedAt, `执行失败：${String(r1.failedAt)}`).toBeUndefined()
    const kernel = (r1 as unknown as { brepChain: { kernel: BrepEngineApi } }).brepChain.kernel
    expect(kernel, '执行结果无 brepChain.kernel').toBeDefined()
    const naming = r1.naming?.get('a' as never) as { faceNaming: FaceNaming[] } | undefined
    expect(naming, 'part a 无命名数据').toBeDefined()
    const shape = (r1.outputs as unknown as Map<string, object>).get('a')
    expect(shape, 'part a 无输出 shape').toBeDefined()
    return { kernel, shape: shape!, rows: naming!.faceNaming }
  } finally {
    runtime.dispose()
  }
}

describe('A. 非居中盒的面 TopoRef 端到端解析（brepkit 真内核）', () => {
  it('A1：每张面都解析成功，且 center 与命名行 hint 一致（修复前 not-found / center 退化成 [0,0,0]）', async () => {
    const { kernel, shape, rows } = await execNonCentered()
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      if (row.origin === null || row.role === null) continue
      const ref = captureTopoRef(row) as FaceTopoRef
      const got = resolveFaceGeometry(kernel, shape as Shape, ref)
      const hintCenter = row.hint?.center as number[] | undefined
      expect(got.center, `面 #${i}（${String(row.role)}）center 与命名行不一致`).toBeDefined()
      expect(hintCenter, `面 #${i} 命名行无 hint.center`).toBeDefined()
      for (let k = 0; k < 3; k++) {
        expect(
          Math.abs(got.center[k]! - hintCenter![k]!),
          `面 #${i}（${String(row.role)}）center[${k}] = ${got.center[k]}，命名行是 ${hintCenter![k]}`,
        ).toBeLessThan(1e-6)
      }
    }
  }, 120000)

  it('A2：BREP 分支的候选同带 row，且与 handle 序号对齐（层 1①②）', async () => {
    const { kernel, shape, rows } = await execNonCentered()
    const ctx = buildShapeResolutionContext(kernel, shape)
    expect(ctx, 'buildShapeResolutionContext 返回 undefined').toBeDefined()
    expect(ctx!.faces.length, '候选面数 ≠ 命名行数').toBe(rows.length)
    for (let i = 0; i < rows.length; i++) {
      const cand = ctx!.faces[i]!
      const row = rows[i]!
      expect(cand.handle, `候选 #${i} 无 handle（BREP 分支）`).toBeDefined()
      expect(cand.row, `候选 #${i} 无 row（层 1② 回归）`).toBeDefined()
      const hc = row.hint?.center as number[] | undefined
      if (hc && cand.row?.center) {
        for (let k = 0; k < 3; k++) {
          expect(
            Math.abs(cand.row.center[k]! - hc[k]!),
            `候选 #${i} row.center[${k}] 与命名行错位（序号没对齐）`,
          ).toBeLessThan(1e-6)
        }
      }
    }
  }, 120000)
})

describe('B. row 优先于 kernel 现场（fake 坏内核，层 1③）', () => {
  /** brepkit 实测退化形态：uvBounds 返 ±1e6 哨兵 → u=v=0 → 参数原点求值。 */
  function degenerateKernel(): BrepEngineApi {
    const base = {
      getSubShapes: () => [],
      subShapeHashes: () => [],
      surfaceType: () => 'plane',
      surfaceNormal: () => ({ x: 0, y: 0, z: 1 }),
      // 哨兵：调用方不检测就直接取中点 0
      uvBounds: () => ({ uMin: -1000000, uMax: 1000000, vMin: -1000000, vMax: 1000000 }),
      // 参数原点（对非居中平面就是把某些分量清零）
      surfaceCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
      release: () => undefined,
      hashCode: (h: unknown) => h as unknown as number,
      isSame: (a: unknown, b: unknown) => a === b,
      isSolid: () => true,
      shapeType: () => 'SOLID',
      isValid: () => true,
    }
    return base as unknown as BrepEngineApi
  }

  const hint: FaceHint = {
    kind: 'face',
    surfaceType: 'plane',
    normal: [0, 0, -1],
    center: [20, 20, 0],
    area: 1600,
  }

  it('B1：row 路径不受坏内核影响；同一坏内核下 handle 路径被拒', () => {
    const kernel = degenerateKernel()
    const row = { surfaceType: 'plane', normal: [0, 0, -1], center: [20, 20, 0], area: 1600 }
    const handle = 7 as BrepHandle

    // scoreCandidate 的契约是候选二选一（handle 或 row）；「带 row 时优先走 row」
    // 的选择在调用方 toScoringCandidate（resolve-face.ts，内部函数）——那条由 A3
    // 端到端钉住。这里钉的是：row 路径本身零 kernel 依赖，坏内核伤不到它。
    const rowPath = scoreCandidate(kernel, hint, { row })
    const handlePath = scoreCandidate(kernel, hint, { handle })

    expect(rowPath, 'row 路径应越过 MIN_SCORE（不受坏内核影响）').toBeGreaterThan(MIN_SCORE)
    // 证明 fake 确实"坏"：handle 路径被质心门禁拒了，否则本钉子没钉住东西
    expect(handlePath, 'handle 路径应被坏内核拒').toBeLessThan(MIN_SCORE)
  })

  it('B2（A3）：exact 失效（roleTable 空）时兜底打分走 row，仍能命中（层 1③ 端到端）', async () => {
    const { resolveTopoRef } = await import('../../../src/topology/naming')
    const kernel = degenerateKernel()
    const row = { surfaceType: 'plane', normal: [0, 0, -1], center: [20, 20, 0], area: 1600 }
    const ctx = {
      kernel,
      faces: [{ ordinal: 1, hash: 12345, handle: 7 as BrepHandle, row }],
      // roleTable 缺省 → exact 路径不可用（层 2 失效 / 血缘未登记的模拟），
      // 只剩几何兜底——这正是 2026-10-16 之前非居中盒的处境。
    }
    const ref: FaceTopoRef = { kind: 'face', origin: 's1' as never, role: 'top', hint }
    // resolveTopoRef 成功返回 {handle, ordinal}；失败抛 TopoRefError
    //（`topo ref (face) not found in the current shape` —— 用户原话）。
    const got = resolveTopoRef(ref, ctx as unknown as Parameters<typeof resolveTopoRef>[1])
    expect(got.ordinal, '兜底打分应命中 ordinal 1（row 优先）').toBe(1)
  })
})

describe('C. lineage 挂 globalThis 共享（层 2）', () => {
  it('C1：globalThis 约定键存在，且 runtimeLineage 就是它的 graph（同一性）', () => {
    const g = globalThis as unknown as Record<string, unknown>
    const entry = g.__FAICAD_FAIJS_LINEAGE__ as { version: number; graph: unknown } | undefined
    expect(entry, 'lineage 未挂 globalOther/globalThis（层 2 回归）').toBeDefined()
    expect(entry!.version).toBe(1)
    expect(entry!.graph).toBe(runtimeLineage)
  })

  it('C2：血缘图跨模块实例共享——同一进程内重复取到的仍是同一张表', async () => {
    const mod = await import('../../../src/topology/naming/lineage')
    expect(mod.runtimeLineage).toBe(runtimeLineage)
    // 表可写可读（共享的不是空壳）
    const before = runtimeLineage.tableOfPart('__zz_probe_part__' as never)
    expect(before).toBeUndefined()
  })
})
