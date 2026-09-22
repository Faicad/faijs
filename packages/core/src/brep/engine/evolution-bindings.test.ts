/**
 * Phase 0.1 绑定回归：`*WithHistory` 的**运行时存在性与行为**（声明 ≠ 运行时存在）。
 *
 * ⚠️ 为什么需要这个测试文件：
 * `initOcctWasm()` 的返回类型在本文件之外被硬断言为 `BrepEngineApi`
 * （`occt-kernel/occtKernel.ts:88/95/106/112` 全部 `as unknown as`），
 * 因此 `engine/adapters/occt.ts:67` 的 `_AssertOcctApi`
 * （`AssertSatisfiesBrepEngineApi`）**恒真、无校验力**——
 * 往 `BrepEngineApi` 里写一个运行时不存在的方法，tsc**不会**报错。
 * 本文件就是这个缺口的补丁：逐个断言存在性，并对 4 个变换类做**真调用**。
 *
 * 事实（2026-09-22 实测，occt-wasm@3.8.4）：
 * - 内核运行时暴露 **12 个** `*WithHistory`（`node_modules/occt-wasm/dist/index.d.ts:458-472`）；
 * - faijs 此前只绑定 5 个（`fillet/chamfer/cut/fuse/intersect`），Phase 0.1 补齐另 7 个；
 * - 刚体变换的权威映射是 **1:1 全覆盖**（`coveredInputs === 面数`、`deleted=[]`、`generated=0`）。
 *
 * GOTCHA: `rotateWithHistory` 的 `angleRad` 单位是**弧度**（与 `rotateBrep` 走
 * `kernel.transform(矩阵)` 不同）。传度数会静默得到完全错误的几何——本文件用 bbox 钉住。
 *
 * 用途：Phase 0.3 用这 4 个变换类权威映射替换 `identityHashEvolution`
 * （`face-evolution.ts:209-222`，按枚举序号对齐的未验证近似）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../../occt-kernel/occtKernel'
import { HASH_UPPER_BOUND } from '../face-evolution'
import type { BrepHandle } from './types'
import type { BrepEngineApi } from './primitives'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

/** occt-wasm@3.8.4 暴露的全部 `*WithHistory`（dist/index.d.ts:458-472，共 12 个）。 */
const ALL_WITH_HISTORY = [
  // 原绑定的 5 个
  'fuseWithHistory',
  'cutWithHistory',
  'intersectWithHistory',
  'filletWithHistory',
  'chamferWithHistory',
  // Phase 0.1 补齐的 7 个
  'translateWithHistory',
  'rotateWithHistory',
  'mirrorWithHistory',
  'scaleWithHistory',
  'shellWithHistory',
  'offsetWithHistory',
  'thickenWithHistory',
] as const

/**
 * 解码 `modified` 的分段编码 `[inHash, count, outHash...] × N`。
 * @param m - the `modified` array from BrepEvolutionData.
 * @returns 覆盖的输入面数与全部输出面 hash。
 */
function decodeModified(m: number[]): { coveredInputs: number; outHashes: number[] } {
  const outHashes: number[] = []
  let coveredInputs = 0
  let idx = 0
  while (idx < m.length) {
    const count = m[idx + 1]
    coveredInputs++
    for (let j = 0; j < count; j++) outHashes.push(m[idx + 2 + j])
    idx += 2 + count
  }
  return { coveredInputs, outHashes }
}

/** 造 box 并取其全部面 hash。 */
function makeBoxFaces(dx: number, dy: number, dz: number): { box: BrepHandle; hashes: number[] } {
  const box = kernel.makeBox(dx, dy, dz)
  const hashes = Array.from(kernel.subShapeHashes(box, 'face', HASH_UPPER_BOUND))
  return { box, hashes }
}

describe('Phase 0.1: *WithHistory 绑定在运行时真实可用', () => {
  it('12 个 *WithHistory 全部存在（含 Phase 0.1 补齐的 7 个）', () => {
    const raw = kernel as unknown as Record<string, unknown>
    for (const name of ALL_WITH_HISTORY) {
      expect(typeof raw[name], `${name} 在运行时不存在或不是函数`).toBe('function')
    }
    expect(ALL_WITH_HISTORY).toHaveLength(12)
  })

  it('translateWithHistory 给出 1:1 全覆盖的权威映射', () => {
    const { box, hashes } = makeBoxFaces(10, 20, 30)
    expect(hashes).toHaveLength(6)

    const evo = kernel.translateWithHistory(box, 5, 0, 0, hashes, HASH_UPPER_BOUND)
    const { coveredInputs, outHashes } = decodeModified(evo.modified)

    // 权威映射覆盖全部输入面、无删除、无新增 —— 即"1:1 保留"的内核版
    expect(coveredInputs).toBe(6)
    expect(outHashes).toHaveLength(6)
    expect(evo.deleted).toEqual([])
    expect(kernel.isValid(evo.result)).toBe(true)
    // 平移产生新句柄（不是原地修改）
    expect(evo.result).not.toBe(box)
  })

  it('rotateWithHistory 收弧度（GOTCHA：传度数会静默得到错误几何）', () => {
    const { box, hashes } = makeBoxFaces(10, 20, 30)
    const evo = kernel.rotateWithHistory(
      box,
      // 绕 Z 轴、过原点
      { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
      Math.PI / 2,
      hashes,
      HASH_UPPER_BOUND,
    )
    expect(decodeModified(evo.modified).coveredInputs).toBe(6)
    expect(kernel.isValid(evo.result)).toBe(true)

    // (0,0,0)-(10,20,30) 绕 Z 逆时针 90° → x 轴转到 y 轴 ⇒ (-20,0,0)-(0,10,30)
    const bb = kernel.getBoundingBox(evo.result)
    expect(bb.xmin).toBeCloseTo(-20, 6)
    expect(bb.xmax).toBeCloseTo(0, 6)
    expect(bb.ymin).toBeCloseTo(0, 6)
    expect(bb.ymax).toBeCloseTo(10, 6)
    expect(bb.zmin).toBeCloseTo(0, 6)
    expect(bb.zmax).toBeCloseTo(30, 6)
  })

  it('scaleWithHistory 的 center 是不动点（均匀缩放）', () => {
    const { box, hashes } = makeBoxFaces(10, 20, 30)
    const evo = kernel.scaleWithHistory(box, { x: 0, y: 0, z: 0 }, 2, hashes, HASH_UPPER_BOUND)
    expect(decodeModified(evo.modified).coveredInputs).toBe(6)
    expect(kernel.isValid(evo.result)).toBe(true)

    const bb = kernel.getBoundingBox(evo.result)
    expect(bb.xmin).toBeCloseTo(0, 6)
    expect(bb.xmax).toBeCloseTo(20, 6)
    expect(bb.ymax).toBeCloseTo(40, 6)
    expect(bb.zmax).toBeCloseTo(60, 6)
  })

  it('mirrorWithHistory 以 {point, normal} 定镜像面，镜像后 bbox 跨到负侧', () => {
    const { box, hashes } = makeBoxFaces(10, 20, 30)
    const evo = kernel.mirrorWithHistory(
      box,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      hashes,
      HASH_UPPER_BOUND,
    )
    expect(decodeModified(evo.modified).coveredInputs).toBe(6)
    expect(kernel.isValid(evo.result)).toBe(true)

    const bb = kernel.getBoundingBox(evo.result)
    expect(bb.xmin).toBeCloseTo(-10, 6)
    expect(bb.xmax).toBeCloseTo(0, 6)
    expect(bb.ymax).toBeCloseTo(20, 6)
    expect(bb.zmax).toBeCloseTo(30, 6)
  })
})
