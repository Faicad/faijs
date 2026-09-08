/**
 * 装配重放 e2e（P1，方案 T9 + R11②）
 *
 * mesh 模式（无 OCCT）端到端：快照形态面引用的装配在
 * - direct（唯一 executorMode）下连续构造的两次重放结果逐分量一致；
 * - 新形态 mate/fixed 约束 + asm.solve() 成员方法（与 do_assemble 同义）可用；
 * - L6 修复：多条约束打同一成员不再叠加（per-member 终态）。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from './runtime'
import { asPartName } from '../identity'
import { createApiNamespace } from '../api/api-namespace'
import type { HostPorts } from './ports'
import { isMeshShape } from '../mesh/types'
import { configureBackends } from '../runtime-state'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const MODULE = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
// direct 是唯一执行路径（executorMode 恒为 'direct'）；两个实例仅用于对照一致性。
const DIRECT = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })

beforeAll(async () => {
  // 全局 backends 认领（mesh 模式；与 direct-executor.test 同构）
  await MODULE.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  void configureBackends
})

/** bbox（positions 的 min/max）。 */
function bbox(shape: unknown): { min: [number, number, number]; max: [number, number, number] } {
  expect(isMeshShape(shape)).toBe(true)
  const ps = (shape as { positions: ArrayLike<number> }).positions
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < ps.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = ps[i + c]
      if (v < min[c]) min[c] = v
      if (v > max[c]) max[c] = v
    }
  }
  return { min, max }
}

describe('T9/R11②: 装配 mesh 重放（module vs direct）', () => {
  it('遗留 face_mate（快照面）：两执行器结果逐分量一致', async () => {
    const code = [
      "let part0 = cad.box(20, 20, 10, { centered: true })",
      "let part1 = cad.box(20, 20, 10, { centered: true, at: [40, 0, 0] })",
      "let asm0 = cad.assembly({ name: 'A', members: [part0, part1], constraints: [{",
      "  type: 'face_mate',",
      "  fixedPartName: 'part0',",
      "  movingPartName: 'part1',",
      "  fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },",
      "  movingFace: { surfaceType: 'plane', center: [40, 0, -5], normal: [0, 0, -1] },",
      "}] })",
      'asm0.do_assemble()',
    ].join('\n')

    const rm = await MODULE.execute(code)
    expect(rm.failedAt).toBeUndefined()
    const rd = await DIRECT.execute(code)
    expect(rd.failedAt).toBeUndefined()

    for (const name of ['part0', 'part1']) {
      const a = rm.outputs.get(asPartName(name))
      const b = rd.outputs.get(asPartName(name))
      expect(a).toBeDefined()
      expect(b).toBeDefined()
      expect(Array.from((a as { positions: ArrayLike<number> }).positions)).toEqual(
        Array.from((b as { positions: ArrayLike<number> }).positions),
      )
    }
    // 贴合不变量：part1 底面 z = part0 顶面 z = 5
    const b0 = bbox(rm.outputs.get(asPartName('part0')))
    const b1 = bbox(rm.outputs.get(asPartName('part1')))
    expect(b0.max[2]).toBeCloseTo(5, 6)
    expect(b1.min[2]).toBeCloseTo(5, 6)
    expect(b1.max[2]).toBeCloseTo(15, 6)
    // 面中心重合语义：moving 面中心 (40,0,−5) 搬到 fixed 面中心 (0,0,5) → 平移 (−40,0,10)
    expect(b1.min[0]).toBeCloseTo(-10, 6)
    expect(b1.max[0]).toBeCloseTo(10, 6)
  })

  it('新形态 mate/fixed + asm.solve()：与 do_assemble 同义（module 与 direct）', async () => {
    const code = [
      "let part0 = cad.box(20, 20, 10, { centered: true })",
      "let part1 = cad.box(20, 20, 10, { centered: true, at: [40, 0, 0] })",
      "let asm1 = cad.assembly({ name: 'B', members: [part0, part1], constraints: [",
      "  { type: 'fixed', part: 'part0' },",
      "  { type: 'mate',",
      "    a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },",
      "    b: { part: 'part1', face: { center: [40, 0, -5], normal: [0, 0, -1] } } },",
      "] })",
      'asm1.solve()',
    ].join('\n')

    const rm = await MODULE.execute(code)
    expect(rm.failedAt).toBeUndefined()
    const rd = await DIRECT.execute(code)
    expect(rd.failedAt).toBeUndefined()

    const a = rm.outputs.get(asPartName('part1'))
    const b = rd.outputs.get(asPartName('part1'))
    expect(Array.from((a as { positions: ArrayLike<number> }).positions)).toEqual(
      Array.from((b as { positions: ArrayLike<number> }).positions),
    )
    const b1 = bbox(a)
    expect(b1.min[2]).toBeCloseTo(5, 6)
    expect(b1.max[2]).toBeCloseTo(15, 6)
    // 面中心重合：x 平移 −40 → [−10, 10]
    expect(b1.min[0]).toBeCloseTo(-10, 6)
    expect(b1.max[0]).toBeCloseTo(10, 6)
  })

  it('L6 修复：两条约束打同一成员 → per-member 终态，不叠加', async () => {
    const code = [
      "let part0 = cad.box(20, 20, 10, { centered: true })",
      "let part1 = cad.box(20, 20, 10, { centered: true, at: [40, 0, 0] })",
      "let asm2 = cad.assembly({ name: 'C', members: [part0, part1], constraints: [",
      "  { type: 'mate',",
      "    a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },",
      "    b: { part: 'part1', face: { center: [40, 0, -5], normal: [0, 0, -1] } } },",
      "  { type: 'mate',",
      "    a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },",
      "    b: { part: 'part1', face: { center: [40, 0, 5], normal: [0, 0, 1] } } },",
      "] })",
      'asm2.do_assemble()',
    ].join('\n')

    const rm = await MODULE.execute(code)
    expect(rm.failedAt).toBeUndefined()
    const b1 = bbox(rm.outputs.get(asPartName('part1')))
    // 求解器每成员只定位一次（第二条约束命中已放置成员被跳过）：
    // 结果是「单次刚性定位」——面中心重合 → x∈[−10,10]、z∈[5,15]。
    // 若按旧 per-constraint 叠加，两次变换会继续平移/翻转（z 或 x 必然越界）。
    expect(b1.min[2]).toBeCloseTo(5, 6)
    expect(b1.max[2]).toBeCloseTo(15, 6)
    expect(b1.min[0]).toBeCloseTo(-10, 6)
    expect(b1.max[0]).toBeCloseTo(10, 6)
  })
})
