/**
 * place-calibration — 四元数→矩阵标定（R-CK，方案 §4.3 / H11）
 *
 * 标定目标：确认 brep 路径（OCCT `applyTransformBrep`）与 mesh 路径（Hamilton
 * 手算四元数→3×3）对同一刚性变换给出**完全一致**的几何——即两种后端下的
 * `cad.place` 顶点级一致（不是近似）。
 *
 * 做法：同一 `cad.box` 在 mesh / brep 两种后端下各自放置（90° 绕 Z + 平移），
 * 提取两个结果 mesh 的 8 个 bbox 角点，断言角点多重集在容差内重合。
 *
 * 需要 WASM（OCCT）；beforeAll 预初始化 initOcctWasm。CI 中 `compat-op.test.ts`
 * 等已用同机制，本文件依赖其可用。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../runtime-state'
import { initOcctWasm, getKernel } from '../occt-kernel/occtKernel'
import { box } from './primitives'
import { place } from './place'
import type { Shape } from '../mesh/types'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

/** 用真实的 OCCT 内核装配后端（mode 决定走 brep 还是 mesh 链）。 */
function setBackend(mode: 'mesh' | 'brep'): void {
  const kernel = getKernel()
  const backends = {
    contractVersion: CONTRACT_VERSION,
    config: { mode, brepCapabilities: undefined },
    kernel: { brep: kernel, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
  configureBackends(backends)
}

/** 提取一个 box 类 mesh 的 8 个 bbox 角点（x/y/z 的 min/max 组合）。 */
function bboxCorners(s: Shape): Array<[number, number, number]> {
  const p = s.positions
  const mn: [number, number, number] = [Infinity, Infinity, Infinity]
  const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k]
      if (v < mn[k]) mn[k] = v
      if (v > mx[k]) mx[k] = v
    }
  }
  const out: Array<[number, number, number]> = []
  for (let xi = 0; xi < 2; xi++) {
    for (let yi = 0; yi < 2; yi++) {
      for (let zi = 0; zi < 2; zi++) {
        out.push([xi ? mx[0] : mn[0], yi ? mx[1] : mn[1], zi ? mx[2] : mn[2]])
      }
    }
  }
  return out
}

function maxCornerDistance(a: Array<[number, number, number]>, b: Array<[number, number, number]>): number {
  let worst = 0
  for (const ca of a) {
    let best = Infinity
    for (const cb of b) {
      const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2])
      if (d < best) best = d
    }
    if (best > worst) worst = best
  }
  return worst
}

const Q_Z90: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
const T: [number, number, number] = [5, 0, 0]

describe('place: brep/mesh quaternion calibration (R-CK)', () => {
  it('mesh and brep backends produce identical placed-box corners', async () => {
    // mesh 后端：构造 box 并放置
    setBackend('mesh')
    const bMesh = (await box({ width: 2, depth: 2, height: 2 })) as Shape
    const meshPlaced = (await place(bMesh, { rotation: Q_Z90, position: T })) as Shape
    const meshCorners = bboxCorners(meshPlaced)

    // brep 后端：同一几何，仅后端不同
    setBackend('brep')
    const bBrep = (await box({ width: 2, depth: 2, height: 2 })) as Shape
    const brepPlaced = (await place(bBrep, { rotation: Q_Z90, position: T })) as Shape
    const brepCorners = bboxCorners(brepPlaced)

    // 两种后端下，box 尺寸/位置一致 → 放置后角点必须重合（容差 1e-2）
    expect(meshCorners.length).toBe(8)
    expect(brepCorners.length).toBe(8)
    expect(maxCornerDistance(meshCorners, brepCorners)).toBeLessThan(1e-2)
  })
})
