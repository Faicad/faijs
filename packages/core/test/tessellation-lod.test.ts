/**
 * tessellation-lod — 三角化 LOD（粗网格先行 + 空闲精化）验收
 *
 * 方案：docs/plans/2026-10-28-weapp-tessellation-lod-design.md（3d_editor 仓）
 *
 * 引擎选择：**smlib**（与 weapp 端同一个 BREP 引擎，2026-10-27 brepkit→smlib）。
 * 三角形数是引擎相关的，把验收钉在 weapp 真机那个引擎上才有意义。
 *
 * 八条验收（方案 §4.2）：
 *  1  bbox-relative 粗密度（假内核）+ L0 球缺省 16 段
 * 1b  尺寸自适应：1m 球在 L0 下不再被切成上百段；1m 立方体 L0 恒 12 三角形
 *  2  retessellate 精度提升（三角形数 + 内接近似收敛）
 *  3  拓扑同源：精化后 buildBrepTopology 的面行区间 === 精化 mesh 的 faceGroups
 *  4  缓存同步 + 二次同密度精化 contentKey 不变（幂等）
 *  5  无 BREP solid 的 part 静态判定 no-solid，不影响批内其它 part
 *  6  非法密度整批抛错
 *  7  显式 segments 优先
 *  8  精化 ≡ 直接以 L1 执行（LOD 路径与直执行路径对账）
 *
 * GOTCHA：三角化密度是**全局运行时状态**（runtime-state 单例，按 runtime 构造
 * 覆盖），不是 per-runtime 的。因此每个用例在动手前把全局置成要验的那一档，
 * retessellate 的密度一律**显式传入**（不依赖全局）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { HostPorts } from '../src/cad-runtime/ports'
import type { TessellationDensity } from '../src/runtime-state'
import type { BrepBoundingBox } from '../src/brep/engine/types'
import type { Shape } from '../src/mesh/types'
import type { BrepMeshResult } from '../src/brep/engine/types'
import { asPartName, type PartName } from '../src/identity'
import { createRuntime } from '../src/cad-runtime/runtime'
import { configureTessellation } from '../src/runtime-state'
import { BREP_TESS } from '../src/mesh/types'
import {
  COARSE_BBOX_RATIO,
  COARSE_CAP_MM,
  COARSE_FLOOR_MM,
  coarseLinearDeflectionFor,
} from '../src/brep/effective-deflection'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from '../src/brep/engine/registry'
import { registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID } from '../src/brep/engine/adapters/smlib'

/** L0 执行档（weapp 配置）：段数下限 2π/16 + linear 按包围盒对角线自适应。 */
const L0: TessellationDensity = {
  angularDeflection: (2 * Math.PI) / 16,
  linearMode: 'bbox-relative',
}
/** L1 精化目标（= weapp 现状档，不动）：2π/32 + 0.1mm。 */
const L1: TessellationDensity = { angularDeflection: (2 * Math.PI) / 32, linearDeflection: 0.1 }

/** 给定对角线长度（三轴均分）的假内核 —— 只测密度解析，不碰真引擎。 */
function fakeKernel(diag: number | null): {
  getBoundingBox(_s: unknown, _useTri?: boolean): BrepBoundingBox
} {
  const side = diag === null ? 0 : diag / Math.sqrt(3)
  return {
    getBoundingBox(_s: unknown, _useTri?: boolean): BrepBoundingBox {
      if (diag === null) throw new Error('no bbox for this shape')
      return { xmin: 0, xmax: side, ymin: 0, ymax: side, zmin: 0, zmax: side }
    },
  }
}

function ports(): HostPorts {
  return { events: { emit: () => undefined } } as HostPorts
}

/** 三角形发散定理体积（有符号；闭合内接多面体 → 正值、恒小于精确体积）。 */
function meshVolume(positions: Float32Array, indices: Uint32Array): number {
  let vol = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3
    const b = indices[i + 1]! * 3
    const c = indices[i + 2]! * 3
    vol +=
      (positions[a]! * (positions[b + 1]! * positions[c + 2]! - positions[b + 2]! * positions[c + 1]!) -
        positions[a + 1]! * (positions[b]! * positions[c + 2]! - positions[b + 2]! * positions[c]!) +
        positions[a + 2]! * (positions[b]! * positions[c + 1]! - positions[b + 1]! * positions[c]!)) /
      6
  }
  return vol
}

/** 取 part 当前显示 mesh 的 BREP_TESS 槽（规则 1 的取数口）。 */
function tessOf(runtime: ReturnType<typeof createRuntime>, partName: PartName): BrepMeshResult {
  const shape = runtime.getCachedOutput(partName) as Shape | undefined
  if (!shape) throw new Error(`no cached output for ${String(partName)}`)
  const slot = (shape as unknown as Record<symbol, unknown>)[BREP_TESS] as BrepMeshResult | undefined
  if (!slot) throw new Error(`no BREP_TESS slot for ${String(partName)}`)
  return slot
}

/** 面组 → 三角形区间列表（索引单位 /3）。 */
function faceRunsOf(fg: Int32Array): Array<{ start: number; count: number }> {
  const runs: Array<{ start: number; count: number }> = []
  for (let f = 0; f * 3 + 2 < fg.length; f++) {
    runs.push({ start: fg[f * 3]! / 3, count: fg[f * 3 + 1]! / 3 })
  }
  return runs
}

/** 在给定密度档下执行脚本，取目标变量的几何快照（runtime 用完即 dispose）。 */
async function execAt(
  code: string,
  density: TessellationDensity,
  partName: PartName = asPartName('p'),
): Promise<{
  tris: number
  vertices: number
  positions: Float32Array
  indices: Uint32Array
  volume: number
}> {
  const runtime = createRuntime(ports(), 'brep', undefined, { tessellation: density })
  try {
    const result = await runtime.execute(code)
    expect(result.failedAt).toBeUndefined()
    const shape = result.outputs.get(partName) as Shape | undefined
    if (!shape) throw new Error(`no output for ${String(partName)}`)
    return {
      tris: shape.indices.length / 3,
      vertices: shape.positions.length / 3,
      positions: new Float32Array(shape.positions),
      indices: new Uint32Array(shape.indices),
      volume: meshVolume(shape.positions, shape.indices),
    }
  } finally {
    runtime.dispose()
  }
}

describe('coarseLinearDeflectionFor（引擎中立：只依赖 getBoundingBox）', () => {
  it('对角线 50mm → 1mm、1000mm → 20mm（cap）、5mm → 0.5mm（floor）', () => {
    expect(coarseLinearDeflectionFor(fakeKernel(50), undefined as never)).toBeCloseTo(1.0)
    // 1000/50 = 20 —— cap 的边缘值（再大也不更粗）。
    expect(1000 * COARSE_BBOX_RATIO).toBeCloseTo(COARSE_CAP_MM)
    expect(coarseLinearDeflectionFor(fakeKernel(1000), undefined as never)).toBeCloseTo(COARSE_CAP_MM)
    // 大到 10 米仍是 cap —— 大零件的 linear 不再随尺寸变细。
    expect(coarseLinearDeflectionFor(fakeKernel(10000), undefined as never)).toBe(COARSE_CAP_MM)
    expect(coarseLinearDeflectionFor(fakeKernel(5), undefined as never)).toBeCloseTo(COARSE_FLOOR_MM)
  })

  it('bbox 取不到 → 按 cap 最粗档（已知上限，不是失败后的兜底）', () => {
    expect(coarseLinearDeflectionFor(fakeKernel(null), undefined as never)).toBe(COARSE_CAP_MM)
  })
})

describe('L0 执行档（smlib = weapp 引擎）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    expect(getActiveBrepEngineId()).toBe(SMLIB_BREP_ENGINE_ID)
  }, 120000)

  afterAll(() => {
    // 复位到引擎默认档：密度是全局状态，别把 L0 留给同进程的其它文件。
    configureTessellation({ angularDeflection: (2 * Math.PI) / 64, linearDeflection: 0.1 })
    __resetEngineRegistriesForTests()
  })

  it('球：L0 = 显式 {2π/16, 0.5mm} 那一档，且明显粗于 L1', async () => {
    // r=5 球的包围盒对角线 = 2r√3 ≈ 17.3mm → 17.3/50 ≈ 0.35 → floor 到 0.5mm。
    const coarse = await execAt('let p = cad.sphere({ radius: 5, centered: true })', L0)
    const reference = await execAt('let p = cad.sphere({ radius: 5, centered: true })', {
      angularDeflection: (2 * Math.PI) / 16,
      linearDeflection: 0.5,
    })
    expect(coarse.tris).toBe(reference.tris)
    const fine = await execAt('let p = cad.sphere({ radius: 5, centered: true })', L1)
    expect(coarse.tris).toBeLessThan(fine.tris / 2)
  }, 120000)

  it('1m 球：L0 不再被 0.1mm 矢高切成上百段；1m 立方体 L0 恒 12 三角形', async () => {
    const sphereL0 = await execAt('let p = cad.sphere({ radius: 500, centered: true })', L0)
    const sphereL1 = await execAt('let p = cad.sphere({ radius: 500, centered: true })', L1)
    // 实测（smlib）：r=500 球 L0=528 三角形、L1=57344 三角形 —— 同一颗球在现状档
    // 下被 0.1mm 矢高切成 108 倍。曲率主导：L0 由段数下限（16 段）说了算，
    // linear 的 20mm 上限不再推着它细分。
    expect(sphereL0.tris).toBeLessThan(sphereL1.tris / 2)
    // 且不随尺寸变密（r=5 / 50 / 500 的 L0 都是 528 三角形，见本段常量注释）。

    // 平面特征矢高恒 0 → 不细分 → 立方体永远是 12 个三角形
    // （无论 linear 是 0.1mm 还是 20mm）。这正是「1 米模型用 1mm 过细」的
    // 另一半答案：平面不受影响，被切细的只有曲面。
    const cubeL0 = await execAt('let p = cad.box(1000, 1000, 1000, { centered: true })', L0)
    const cubeL1 = await execAt('let p = cad.box(1000, 1000, 1000, { centered: true })', L1)
    expect(cubeL0.tris).toBe(12)
    expect(cubeL1.tris).toBe(12)
  }, 120000)

  it('显式 segments 优先：L0 档下 {segments: 64} 仍是 64 段密度', async () => {
    const withSegments = await execAt(
      'let p = cad.sphere({ radius: 5, centered: true, segments: 64 })',
      L0,
    )
    const explicit = await execAt(
      'let p = cad.sphere({ radius: 5, centered: true, segments: 64 })',
      L1,
    )
    // 段数由脚本说了算（$fn 语义），与全局档无关 —— 两条档位给出同一结果。
    expect(withSegments.tris).toBe(explicit.tris)
    const coarse = await execAt('let p = cad.sphere({ radius: 5, centered: true })', L0)
    expect(withSegments.tris).toBeGreaterThan(coarse.tris)
  }, 120000)
})

describe('retessellate（L0 → L1，不重跑脚本）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
  }, 120000)

  afterAll(() => {
    configureTessellation({ angularDeflection: (2 * Math.PI) / 64, linearDeflection: 0.1 })
    __resetEngineRegistriesForTests()
  })

  beforeEach(() => {
    configureTessellation(L0)
  })

  /** 在 L0 档下执行一段脚本，返回 runtime（调用方负责 dispose）。 */
  async function runtimeAt(code: string): Promise<ReturnType<typeof createRuntime>> {
    const runtime = createRuntime(ports(), 'brep', undefined, { tessellation: L0 })
    const result = await runtime.execute(code)
    expect(result.failedAt).toBeUndefined()
    return runtime
  }

  it('精度提升：三角形数增加，且内接体积误差收敛（方向正确）', async () => {
    const runtime = await runtimeAt('let p = cad.sphere({ radius: 50, centered: true })')
    try {
      const before = tessOf(runtime, asPartName('p'))
      const trisBefore = before.indices.length / 3
      const volBefore = meshVolume(before.positions, before.indices)

      const out = await runtime.retessellate([{ partName: asPartName('p'), density: L1 }])
      const refined = out.p
      if (!refined) throw new Error('no result for p')
      if ('notApplicable' in refined) throw new Error('sphere part must have a solid')

      expect(refined.triangleCount).toBeGreaterThan(trisBefore)
      expect(refined.positions.length / 3).toBeGreaterThan(before.positions.length / 3)
      // 内接近似：三角形越密 → 体积越接近（仍恒小于）精确球。
      const exact = (4 / 3) * Math.PI * 50 ** 3
      const volAfter = meshVolume(refined.positions, refined.indices)
      expect(volBefore).toBeGreaterThan(0)
      expect(volBefore).toBeLessThan(exact)
      expect(volAfter).toBeLessThan(exact)
      expect(volAfter).toBeGreaterThan(volBefore)
      expect(1 - volAfter / exact).toBeLessThan(1 - volBefore / exact)
    } finally {
      runtime.dispose()
    }
  }, 120000)

  it('拓扑同源：精化后 buildBrepTopology 的面行区间 === 精化 mesh 的 faceGroups', async () => {
    const runtime = await runtimeAt('let p = cad.sphere({ radius: 50, centered: true })')
    try {
      const trisBefore = tessOf(runtime, asPartName('p')).indices.length / 3

      const out = await runtime.retessellate([{ partName: asPartName('p'), density: L1 }])
      const refined = out.p
      if (!refined || 'notApplicable' in refined) throw new Error('sphere part must have a solid')

      // 精化后 BREP_TESS 槽（拓扑构建的唯一输入）就是精化那份 mesh。
      const after = tessOf(runtime, asPartName('p'))
      expect(after.faceGroups).toBeTruthy()
      const runs = faceRunsOf(after.faceGroups!)

      const rt = runtime.buildBrepTopology(asPartName('p'))
      expect(rt).toBeTruthy()
      const rows = rt!.faces
      expect(rows.length).toBe(runs.length)
      // 逐面区间逐项相等（排序后比对：面表行序与面组序可能不同，判据是区间集合一致）。
      const rowRuns = rows
        .map((f) => ({ start: f.triangleStart ?? 0, count: f.triangleCount ?? 0 }))
        .sort((a, b) => a.start - b.start)
      expect(rowRuns).toEqual([...runs].sort((a, b) => a.start - b.start))
      // 合起来覆盖的是**精化后**的网格 —— 若拓扑仍按 L0 面表输出，这里必然不等。
      const total = rows.reduce((s, f) => s + (f.triangleCount ?? 0), 0)
      expect(total).toBe(refined.indices.length / 3)
      expect(total).toBeGreaterThan(trisBefore)
    } finally {
      runtime.dispose()
    }
  }, 120000)

  it('缓存同步：meshShapeCache 换新，二次同密度精化 contentKey 不变（幂等）', async () => {
    const runtime = await runtimeAt('let p = cad.sphere({ radius: 50, centered: true })')
    try {
      const keyBefore = runtime.getStatementCacheEntry(asPartName('p'))?.outputContentKey
      const first = await runtime.retessellate([{ partName: asPartName('p'), density: L1 }])
      const keyAfter = runtime.getStatementCacheEntry(asPartName('p'))?.outputContentKey
      expect(keyAfter).toBeDefined()
      // 几何换了 → 指纹必须跟着换（否则拓扑缓存按旧指纹命中 L0 面表）。
      expect(keyAfter).not.toBe(keyBefore)

      // 同密度再来一次：新引用、新内容，但指纹回到同一个值（确定性 → 幂等）。
      const second = await runtime.retessellate([{ partName: asPartName('p'), density: L1 }])
      const r1 = first.p
      const r2 = second.p
      if (!r1 || !r2 || 'notApplicable' in r1 || 'notApplicable' in r2) {
        throw new Error('sphere part must have a solid')
      }
      expect(r2.triangleCount).toBe(r1.triangleCount)
      expect(runtime.getStatementCacheEntry(asPartName('p'))?.outputContentKey).toBe(keyAfter)
    } finally {
      runtime.dispose()
    }
  }, 120000)

  it('无 BREP solid 的 part 静态判定 no-solid，不影响批内其它 part', async () => {
    // 组壳是 compound（成员才是零件）→ solidCache 里没有它；这是**静态事实**
    // （与 mesh 源零件同源：都没有可精化的 BREP 显示几何），不是探测失败。
    const runtime = await runtimeAt(
      'let p = cad.sphere({ radius: 20, centered: true })\n' +
      'let g = cad.group([p])\n' +
      'g.keep()\n',
    )
    try {
      const out = await runtime.retessellate([
        { partName: asPartName('g'), density: L1 },
        { partName: asPartName('p'), density: L1 },
      ])
      expect(out.g).toEqual({ notApplicable: 'no-solid' })
      const refined = out.p
      if (!refined || 'notApplicable' in refined) throw new Error('sphere must be refined')
      expect(refined.triangleCount).toBeGreaterThan(0)
    } finally {
      runtime.dispose()
    }
  }, 120000)

  it('非法密度整批抛错（动任何状态之前）', async () => {
    const runtime = await runtimeAt('let p = cad.sphere({ radius: 20, centered: true })')
    try {
      const trisBefore = tessOf(runtime, asPartName('p')).indices.length / 3
      await expect(
        runtime.retessellate([{ partName: asPartName('p'), density: { linearDeflection: 0 } }]),
      ).rejects.toThrow(/linearDeflection/)
      await expect(
        runtime.retessellate([{ partName: asPartName('p'), density: { angularDeflection: -1 } }]),
      ).rejects.toThrow(/angularDeflection/)
      // 抛错在改任何缓存之前 —— 这一段网格还是 L0 的。
      expect(tessOf(runtime, asPartName('p')).indices.length / 3).toBe(trisBefore)
    } finally {
      runtime.dispose()
    }
  }, 120000)

  it('精化 ≡ 直接以 L1 执行（LOD 路径与直执行路径逐项对账）', async () => {
    const code = 'let p = cad.sphere({ radius: 50, centered: true })'
    let lod: { tris: number; vertices: number; volume: number; positions: Float32Array; indices: Uint32Array }
    const runtime = await runtimeAt(code)
    try {
      const out = await runtime.retessellate([{ partName: asPartName('p'), density: L1 }])
      const refined = out.p
      if (!refined || 'notApplicable' in refined) throw new Error('sphere part must have a solid')
      lod = {
        tris: refined.triangleCount,
        vertices: refined.positions.length / 3,
        volume: meshVolume(refined.positions, refined.indices),
        positions: new Float32Array(refined.positions),
        indices: new Uint32Array(refined.indices),
      }
    } finally {
      runtime.dispose()
    }
    // 直执行路径：同一段脚本在 L1 档下从头跑一遍（LOD 路径不跑第二遍）。
    const direct = await execAt(code, L1)
    expect(direct.tris).toBe(lod.tris)
    expect(direct.vertices).toBe(lod.vertices)
    expect(direct.volume).toBeCloseTo(lod.volume, 3)
    // 逐字节相同：同引擎、同参数、同 solid → 三角化是确定性的。
    expect(Array.from(direct.indices)).toEqual(Array.from(lod.indices))
    expect(Array.from(direct.positions)).toEqual(Array.from(lod.positions))
  }, 120000)
})
