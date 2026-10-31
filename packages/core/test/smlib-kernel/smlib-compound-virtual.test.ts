/**
 * smlib-kernel/smlib-compound-virtual — compound 虚拟容器防回归（2026-10-28）
 *
 * 语义红线（用户明确要求）：compound 是 **faijs 语义层的逻辑容器**，零件必须
 * 永远独立、**绝不进入内核做布尔合并**。早期实现把 makeCompound 映射为
 * SmApiMergeBrepsEx(UNION=1) 是错误语义（零件被焊死、相交输入被融合、
 * 拓扑/拾取/导出全错）；本测试锁定修复后的行为：
 *   - makeCompound 返回**虚拟句柄** + 子零件登记表，不触内核；
 *   - 相交零件组合后仍各自独立（getSubShapes('solid') 返回原零件）；
 *   - compound 体积 = 各零件体积之和（**不扣重叠**，与 occt TopoDS_Compound 一致）；
 *   - 变换单个零件不影响其它零件；
 *   - meshShape 逐零件三角化拼接（顶点数 = 各零件之和）；
 *   - exportStep 逐零件导出（STEP 含多实体，不焊合）；
 *   - 单成员 compound 直接返回零件本身。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSmlibPrimitives, disposeSmlib } from '../../src/smlib-kernel/smlibKernel'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'

let p!: BrepEngineApi

/** box(10,20,30) @ 原点（体积 6000）+ box(5,5,5) 平移到 (8,8,8)（与前者角部相交）。 */
function twoIntersectingBoxes(): { b1: BrepHandle; b2: BrepHandle } {
  const b1 = p.makeBox(10, 20, 30)
  const b2 = p.makeBox(5, 5, 5)
  p.translate(b2, 8, 8, 8)
  return { b1, b2 }
}

beforeAll(async () => {
  p = await createSmlibPrimitives()
})

afterAll(() => {
  disposeSmlib()
})

describe('smlib compound 虚拟容器（零件独立，禁布尔合并）', () => {
  it('makeCompound 不布尔合并：相交两 box 仍是 2 个独立零件，体积 = 两零件之和（不扣重叠）', () => {
    const { b1, b2 } = twoIntersectingBoxes()
    const c = p.makeCompound([b1, b2])
    // 虚拟句柄 ≠ 任一零件句柄（未焊合、未返回单个零件）
    expect(c).not.toBe(b1)
    expect(c).not.toBe(b2)
    // 子零件独立可取（occt compound 语义：零件保留，可分别查询）
    const kids = p.getSubShapes(c, 'solid')
    expect(kids).toHaveLength(2)
    // 体积 = 6000 + 125 = 6125（重叠不扣——UNION 会是 6000+125−重叠）
    expect(p.getVolume(c)).toBeCloseTo(6125, 6)
    // 表面：isSolid(compound) = false（虚拟容器不是实体）
    expect(p.isSolid(c)).toBe(false)
  })

  it('变换单个零件不影响其它零件（独立性）', () => {
    const { b1, b2 } = twoIntersectingBoxes()
    const c = p.makeCompound([b1, b2])
    const before = p.getBoundingBox(b1)
    // 只移动 b2（+Z 50），b1 必须纹丝不动
    p.translate(b2, 0, 0, 50)
    const afterB1 = p.getBoundingBox(b1)
    expect(afterB1.xmin).toBeCloseTo(before.xmin, 6)
    expect(afterB1.ymin).toBeCloseTo(before.ymin, 6)
    expect(afterB1.zmin).toBeCloseTo(before.zmin, 6)
    const cb = p.getBoundingBox(c)
    // SMLib 平移内核有 ~2e-5 数值误差，用 1e-4 精度
    expect(cb.zmax).toBeCloseTo(8 + 5 + 50, 4) // b2 顶面到了 63
  })

  it('单成员 compound 直接返回零件本身（occt 单成员等价）', () => {
    const b = p.makeBox(3, 4, 5)
    expect(p.makeCompound([b])).toBe(b)
  })

  it('meshShape 逐零件三角化拼接：顶点数 = 各零件之和', () => {
    const { b1, b2 } = twoIntersectingBoxes()
    const c = p.makeCompound([b1, b2])
    const m1 = p.meshShape(b1)
    const m2 = p.meshShape(b2)
    const mc = p.meshShape(c)
    expect(mc.vertexCount).toBe(m1.vertexCount + m2.vertexCount)
    expect(mc.triangleCount).toBe(m1.triangleCount + m2.triangleCount)
    expect(mc.faceGroups).toBeDefined()
    expect(mc.faceCount).toBe((m1.faceCount ?? 0) + (m2.faceCount ?? 0))
    // 索引偏移正确：第二块零件的三角形顶点索引落在自身顶点区间（独立拼接）
    const m1IdxMax = Math.max(...Array.from(m1.indices))
    const m2IdxMax = Math.max(...Array.from(m2.indices))
    const mcIdxMax = Math.max(...Array.from(mc.indices))
    expect(mcIdxMax).toBe(Math.max(m1IdxMax, m1.vertexCount + m2IdxMax))
  })

  it('exportStep 逐零件导出：STEP 含多实体（面数 > 单 box 的 6 面），不焊合', () => {
    const { b1, b2 } = twoIntersectingBoxes()
    const c = p.makeCompound([b1, b2])
    const single = p.exportStep(b1)
    const multi = p.exportStep(c)
    const facesOf = (s: string): number => (s.match(/ADVANCED_FACE/g) ?? []).length
    // 单 box = 6 面；compound = 6 + 6 = 12 面（两个独立实体，各 6 面）
    expect(facesOf(single)).toBe(6)
    expect(facesOf(multi)).toBe(12)
  })

  it('嵌套 compound：getSubShapes 递归展平子零件', () => {
    const { b1, b2 } = twoIntersectingBoxes()
    const b3 = p.makeBox(2, 2, 2)
    const inner = p.makeCompound([b1, b2])
    const outer = p.makeCompound([inner, b3])
    const kids = p.getSubShapes(outer, 'solid')
    expect(kids).toHaveLength(3)
    expect(p.getVolume(outer)).toBeCloseTo(6000 + 125 + 8, 6)
  })
})
