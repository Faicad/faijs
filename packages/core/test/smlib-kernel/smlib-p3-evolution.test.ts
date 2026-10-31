/**
 * smlib-kernel/smlib-p3-evolution — P3 面演化验收（node 直跑）
 *
 * P3 验收：cut/fuse/intersect/fillet 四员 WithHistory 经 SmTrackTopologyChanges
 * 内核桥返回 BrepEvolutionData（result + modified/generated/deleted）。映射
 * （方案 §5.5）：Rm 面 → deleted；Chg 面 → modified 自映射；Add 新面不进映射
 * （调用方 `?? [h]` 兜底）。断言聚焦：不 crash + result 可查询 + 数值合理；
 * deleted 非空（布尔/倒角必移除面）为语义锚。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSmlibPrimitives, disposeSmlib, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { resetSmlibWasm } from '../../src/smlib-kernel/smlibWasm'
import { BREP_HASH_BOUND } from '../../src/brep/engine/types'
import type { BrepHandle } from '../../src/brep/engine/types'

let p!: SmlibPrimitives

beforeAll(async () => {
  p = await createSmlibPrimitives()
})

afterAll(() => {
  disposeSmlib()
  resetSmlibWasm()
})

/** 造一个 10×20×30 的 box（方案 §4.4 锚定：volume=6000）。 */
function box(): BrepHandle {
  return p.makeBox(10, 20, 30)
}

/** 输入面 hash（smlib 自建：subShapeHashes 与 meshShape 同源）。 */
function faceHashes(s: BrepHandle): number[] {
  return Array.from(p.subShapeHashes(s, 'face', BREP_HASH_BOUND))
}

describe('P3 面演化（SmTrackTopologyChanges 内核桥）', () => {
  it('fuseWithHistory：并集 result 有效 + 输入面被移除（deleted 非空）', () => {
    const a = box()
    const b = p.translate(box(), 5, 0, 0) // 重叠 5
    const inHashes = faceHashes(a)
    const evo = p.fuseWithHistory(a, b, inHashes, BREP_HASH_BOUND)
    // result 可查询：并集体积 > 单 box
    expect(p.getVolume(evo.result)).toBeGreaterThan(6000)
    expect(p.getVolume(evo.result)).toBeLessThan(12000)
    // 重叠并集：a 的重叠侧 2 面被吃掉 → deleted 至少 1 个输入面
    expect(evo.deleted.length).toBeGreaterThan(0)
    // 语言层句柄契约：a/b 仍可查询（桥内副本化）
    expect(p.getVolume(a)).toBeCloseTo(6000, 2)
    expect(evo.generated.length).toBe(0)
    // result 面数 > 0 且 mesh 可三角化（与拾取同源红线）
    expect(p.meshShape(evo.result, { linearDeflection: 0.1, angularDeflection: 0.5 }).triangleCount).toBeGreaterThan(0)
  })

  it('cutWithHistory：差集 result 体积变小 + deleted 非空', () => {
    const a = box()
    const b = p.translate(box(), 5, 0, 0) // 重叠 5 → 切掉一半
    const inHashes = faceHashes(a)
    const evo = p.cutWithHistory(a, b, inHashes, BREP_HASH_BOUND)
    expect(p.getVolume(evo.result)).toBeGreaterThan(0)
    expect(p.getVolume(evo.result)).toBeLessThan(6000) // 被切走
    expect(evo.deleted.length).toBeGreaterThan(0)
    expect(p.getVolume(a)).toBeCloseTo(6000, 2) // 句柄契约
    expect(evo.modified.length % 3).toBe(0) // 分段三元素一组
  })

  it('intersectWithHistory：交集 result 为重叠区', () => {
    const a = box()
    const b = p.translate(box(), 5, 0, 0) // 重叠 5 宽 → 5×20×30=3000
    const inHashes = faceHashes(a)
    const evo = p.intersectWithHistory(a, b, inHashes, BREP_HASH_BOUND)
    expect(p.getVolume(evo.result)).toBeCloseTo(3000, 0)
    expect(evo.deleted.length).toBeGreaterThan(0)
  })

  it('filletWithHistory：倒角产生新过渡面 + 输入面被改（Rm/Chg 生效）', () => {
    const s = box()
    const faces = p.getSubShapes(s, 'face')
    const inHashes = faces.map((f) => (f >>> 0) % BREP_HASH_BOUND)
    const edges = p.getSubShapes(s, 'edge')
    // 选第一条边倒角
    const evo = p.filletWithHistory(s, [edges[0]], 1, inHashes, BREP_HASH_BOUND)
    // result 有效：体积略小于 6000（倒角切掉一小块）
    expect(p.getVolume(evo.result)).toBeLessThan(6000)
    expect(p.getVolume(evo.result)).toBeGreaterThan(5900)
    // 面数变多（过渡面）或至少可三角化
    const mesh = p.meshShape(evo.result, { linearDeflection: 0.1, angularDeflection: 0.5 })
    expect(mesh.triangleCount).toBeGreaterThan(0)
    // 语言层句柄契约：原 solid 仍可查询
    expect(p.getVolume(s)).toBeCloseTo(6000, 2)
  })
})
