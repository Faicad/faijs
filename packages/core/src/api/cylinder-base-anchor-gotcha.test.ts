/**
 * cylinder / cone BASE 锚点语义防回归（fcstd 移植 parity 诊断产物）
 *
 * GOTCHA（2026-09-30，fcstd-port parity 复盘）：FCStd 的 `Part::Cylinder` 位置
 * 是「底面轴心」（Placement.position = 圆柱底面中心），fcstd codegen 据此发射
 * `cad.cylinder({ at: [x,y,z], centered: false })`。faijs 的契约（JSDoc 钉死）：
 * - `at` = 底面轴心（BASE 语义），几何从 at 沿 +Z 延伸 height；
 * - `centered: true` = 底面落到 −h/2（无 at 时居中到原点）。
 *
 * 实测口径（brep 与 mesh 双链路必须一致）：
 *   cylinder({ radius: 1, height: 15, at: [0,0,-2.5], centered: false })
 *   → z ∈ [-2.5, +12.5]（不是 [-5, +10]）。
 * fcstd 语料 320 例 parity com/bbox 失败（bbox(1.67e-01)/com(5.00e-01) 主峰）
 * 的产物正是被打成 [-5,10]——即旧引擎 tgz（≤0.21.x）曾把 at 当「中心」处理，
 * 整体下移 h/2。当前源码已正确；本测试钉住该语义防回归。重转后这批假象应消失。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../runtime-state'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../brep/engine/registry'
import { cylinder } from './primitives'
import type { Shape } from '../mesh/types'

beforeAll(async () => {
  await initOcctWasm()
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}, 120000)

async function setBackend(mode: 'mesh' | 'brep'): Promise<void> {
  const kernel = (await getBrepEngine()).primitives
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode, brepCapabilities: undefined },
    kernel: { brep: kernel, csg: undefined, sdf: undefined },
    fonts: undefined, texture: undefined, assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}

/** mesh 载荷的 z 向 bbox（三角化精度 ~1e-3，容差放宽到 1e-2）。 */
function zExtent(s: Shape): [number, number] {
  const p = s.positions
  let mn = Infinity, mx = -Infinity
  for (let i = 2; i < p.length; i += 3) {
    if (p[i]! < mn) mn = p[i]!
    if (p[i]! > mx) mx = p[i]!
  }
  return [mn, mx]
}

describe('cylinder BASE anchor semantics (fcstd parity GOTCHA)', () => {
  it('at is the base-axis center: z ∈ [at.z, at.z + height] on both backends', async () => {
    await setBackend('brep')
    const brepC = (await cylinder({ radius: 1, height: 15, at: [0, 0, -2.5], centered: false })) as Shape
    expect(zExtent(brepC)[0]).toBeCloseTo(-2.5, 6)
    expect(zExtent(brepC)[1]).toBeCloseTo(12.5, 6)

    await setBackend('mesh')
    const meshC = (await cylinder({ radius: 1, height: 15, at: [0, 0, -2.5], centered: false })) as Shape
    const [mn, mx] = zExtent(meshC)
    expect(mn).toBeGreaterThanOrEqual(-2.5 - 1e-2)
    expect(mn).toBeLessThan(-2.4)
    expect(mx).toBeLessThanOrEqual(12.5 + 1e-2)
    expect(mx).toBeGreaterThan(12.4)
  })
})
