/**
 * ops/fai_split — op 层（脚本面）分离参数测试。
 *
 * 与 `test/extra/mesh/fai_split.basis.test.ts` 的分工：basis 测内部统一入口
 * `splitWithParams`；本文件测**脚本面 op `fai_split` 本身** —— 校验 op 层接住
 * params → V 的换算，以及「两端都不传 ⇒ 不分开」这条对外契约确实成立。
 *
 * 走 mesh 分支（manifold CSG），不需要 BREP 内核。
 */
import { describe, it, expect } from 'vitest'
import { fai_split } from '../../../src/extra/ops/fai_split'
import { configureBackends, CONTRACT_VERSION } from '../../../src/runtime-state'
import { geoToManifoldMesh } from '@faicad/faijs/boolean/csg-backend'
import { boxGeometry } from '@faicad/faijs/mesh/meshdata/parametric'
import type { Shape } from '@faicad/faijs/mesh/types'

/**
 * op 层走 mesh 分支需要宿主装配后端（没有它 `dispatchPath` 抛
 * `backends not configured`）。这里给最小 mesh-only 配置：不带 BREP 内核，
 * 用 `mode:'mesh'` 强制走 mesh 实现。
 */
configureBackends({
  contractVersion: CONTRACT_VERSION,
  config: { mode: 'mesh' },
  kernel: { brep: undefined, csg: undefined, sdf: undefined },
  fonts: undefined,
  texture: undefined,
  assets: undefined,
  events: { emit: () => undefined },
} as unknown as Parameters<typeof configureBackends>[0])

/** 边长 2 的单位盒（z∈[-1,1]），紧凑 enough for a fast manifold split. */
function unitBox(): Shape {
  return geoToManifoldMesh(boxGeometry(2, 2, 2))
}

/** z 轴上的极值（用于判定 HALF 是否被平移）。 */
function zExtent(p: Float32Array): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 2; i < p.length; i += 3) {
    min = Math.min(min, p[i])
    max = Math.max(max, p[i])
  }
  return { min, max }
}

describe('fai_split — separation params at the script face (mesh branch)', () => {
  it('neither param given ⇒ the halves stay put (no implicit explode)', async () => {
    // 2026-10-24 起 faijs 不再替宿主决定要拉开：不传就是不动。
    // 这是本次变更的核心不变量 —— 旧行为是默认 true（bbox 对角线 2%）。
    const box = unitBox()
    // op 层（defineOp 产物）：不传分离参数 = 不动。
    const { front, back } = (await fai_split(box, {
      cutMode: 'plane',
      normal: [0, 0, 1],
      offset: 0,
    })) as unknown as Record<string, Shape>

    const f = zExtent(front.positions)
    const b = zExtent(back.positions)
    // Box z∈[-1,1]，在 z=0 切开 → front z∈[0,1]，back z∈[-1,0]，切面处紧贴。
    expect(f.min).toBeCloseTo(0, 4)
    expect(b.max).toBeCloseTo(0, 4)
  })

  it('separationRatio + separation ⇒ both halves move ±V along the normal', async () => {
    const diag = Math.sqrt(2 * 2 + 2 * 2 + 2 * 2)
    const expected = diag * 0.02 + 1

    const { front, back } = (await fai_split(unitBox(), {
      cutMode: 'plane',
      normal: [0, 0, 1],
      offset: 0,
      separationRatio: 0.02,
      separation: 1,
    })) as unknown as Record<string, Shape>

    const f = zExtent(front.positions)
    const b = zExtent(back.positions)
    expect(f.min).toBeCloseTo(expected, 4)
    expect(b.max).toBeCloseTo(-expected, 4)
  })

  it('the new params reproduce the pre-change default exactly', async () => {
    // 「效果一致」：旧默认 V = 对角线×2% + 半个榫卯深度；宿主如今显式传同样的量。
    const box = unitBox()
    const diag = Math.sqrt(2 * 2 + 2 * 2 + 2 * 2)
    const jointDepth = 4
    const oldV = diag * 0.02 + jointDepth / 2

    const { front } = (await fai_split(box, {
      cutMode: 'plane',
      normal: [0, 0, 1],
      offset: 0,
      separationRatio: 0.02,
      separation: jointDepth / 2,
    })) as unknown as Record<string, Shape>
    expect(zExtent(front.positions).min).toBeCloseTo(oldV, 4)
  })
})
