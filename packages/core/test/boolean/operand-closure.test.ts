/**
 * boolean/operand-closure — OpenSCAD 操作数闭合性校验的纯函数单测
 *
 * 方案 2026-10-28-boolean-operand-validation v2 §9。不依赖真实 BREP 引擎：判据本身
 * 是纯函数（网格无向边计数 + 叶子标记），`api` 只用来读 `shapeType`，可注入桩。
 */

import { describe, it, expect } from 'vitest'
import {
  setBooleanOperandValidation,
  getBooleanOperandValidation,
  isClosedOperandForBooleanOp,
} from '../../src/api/internal/boolean-closure'
import { markAuthoredLeaf, isAuthoredLeaf, EXT_LEAF_OPS } from '../../src/api/internal/authored-leaf'
import {
  recordAuthoredClosure,
  readAuthoredClosure,
  clearAuthoredClosure,
} from '../../src/api/internal/authored-closure'
import { AUTHORED_LEAF } from '../../src/mesh/types'
import type { Shape } from '../../src/mesh/types'
import type { getBrepApi } from '../../src/brep/handle-bridge'

/** 只读 shapeType 的桩内核面。 */
function stubApi(shapeType = 'solid'): ReturnType<typeof getBrepApi> {
  return { shapeType: () => shapeType } as unknown as ReturnType<typeof getBrepApi>
}

/** 由顶点表 + 三角索引表造一个最小 Shape（判据只看 positions / indices）。 */
function meshShape(positions: number[], indices: number[]): Shape {
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  } as Shape
}

/** 闭合四面体：4 顶点 / 4 三角 / 6 条边，每条边恰被 2 个三角共用。 */
const TETRA_POINTS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]
const TETRA_TRIS = [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]

/** 两个四面体沿一条棱相接：该棱被 4 个三角共用（非流形）。 */
const EDGE_TOUCH_POINTS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0]
const EDGE_TOUCH_TRIS = [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3, 0, 1, 4, 0, 1, 3]

describe('operand closure (OpenSCAD 语义)', () => {
  it('开关默认关闭，可开可关', () => {
    expect(getBooleanOperandValidation()).toBe(false)
    setBooleanOperandValidation(true)
    expect(getBooleanOperandValidation()).toBe(true)
    setBooleanOperandValidation(false)
    expect(getBooleanOperandValidation()).toBe(false)
  })

  it('闭合网格判定为闭合（每条无向边恰被 2 个三角共用）', () => {
    const s = meshShape(TETRA_POINTS, TETRA_TRIS)
    markAuthoredLeaf(s)
    const r = isClosedOperandForBooleanOp(stubApi(), 1, s)
    expect(r.leaf).toBe(true)
    expect(r.tris).toBe(4)
    expect(r.closed).toBe(true)
  })

  it('缺一个面 ⇒ 边界边 ⇒ 非闭合', () => {
    // 去掉第 4 个三角，剩下 3 个三角的 3 条外边各只被 1 个三角共用。
    const s = meshShape(TETRA_POINTS, TETRA_TRIS.slice(0, 9))
    markAuthoredLeaf(s)
    const r = isClosedOperandForBooleanOp(stubApi(), 1, s)
    expect(r.closed).toBe(false)
    expect(r.hist['1']).toBe(3)
  })

  it('两体共棱 ⇒ 非流形边（被 4 个三角共用）⇒ 非闭合', () => {
    const s = meshShape(EDGE_TOUCH_POINTS, EDGE_TOUCH_TRIS)
    markAuthoredLeaf(s)
    const r = isClosedOperandForBooleanOp(stubApi(), 1, s)
    expect(r.closed).toBe(false)
    expect(r.hist['4']).toBe(1)
  })

  it('非叶子网格（布尔产物 / 未标记）一律不校验 ⇒ 视为闭合', () => {
    // 故意用一个开放网格：未打标记时绝不能被判为非闭合（fail-safe）。
    const s = meshShape(TETRA_POINTS, TETRA_TRIS.slice(0, 9))
    const r = isClosedOperandForBooleanOp(stubApi(), 1, s)
    expect(r.leaf).toBe(false)
    expect(r.closed).toBe(true)
  })

  it('叶子网格但拓扑类型是非实体 ⇒ 非闭合', () => {
    const s = meshShape(TETRA_POINTS, TETRA_TRIS)
    markAuthoredLeaf(s)
    for (const t of ['wire', 'face', 'shell', 'vertex', 'edge']) {
      expect(isClosedOperandForBooleanOp(stubApi(t), 1, s).closed).toBe(false)
    }
  })

  it('叶子网格但无句柄 ⇒ 非闭合', () => {
    const s = meshShape(TETRA_POINTS, TETRA_TRIS)
    markAuthoredLeaf(s)
    expect(isClosedOperandForBooleanOp(stubApi(), undefined, s).closed).toBe(false)
  })

  it('叶子网格但无三角载荷（未物化）⇒ 不判，视为闭合', () => {
    const s = { positions: new Float32Array(0), indices: new Uint32Array(0) } as Shape
    markAuthoredLeaf(s)
    expect(isClosedOperandForBooleanOp(stubApi(), 1, s).closed).toBe(true)
  })

  it('接缝重复顶点按坐标去重，不误报边界边', () => {
    // 同一个闭合四面体，但把顶点 0 复制一份（索引 4）并用它替换部分三角中的 0。
    const positions = [...TETRA_POINTS, 0, 0, 0] // 索引 4 与 0 同坐标
    const tris = [4, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]
    const s = meshShape(positions, tris)
    markAuthoredLeaf(s)
    expect(isClosedOperandForBooleanOp(stubApi(), 1, s).closed).toBe(true)
  })
})

describe('authored-closure 句柄登记表（ext 缝补前结论）', () => {
  it('登记为开放 ⇒ 覆盖按产物 mesh 的判定（产物已被缝补成闭合）', () => {
    clearAuthoredClosure()
    // 产物 mesh 是闭合四面体（缝补后），但作者原始三角开放 ⇒ 必须判为不闭合。
    const s = meshShape(TETRA_POINTS, TETRA_TRIS)
    markAuthoredLeaf(s)
    expect(isClosedOperandForBooleanOp(stubApi(), 7, s).closed).toBe(true)
    recordAuthoredClosure(7, false)
    const r = isClosedOperandForBooleanOp(stubApi(), 7, s)
    expect(r.closed).toBe(false)
    expect(r.leaf).toBe(true)
    expect(r.tris).toBe(-3) // 结论来自登记表，不走边计数
    clearAuthoredClosure()
  })

  it('只登记开放者：closed=true 不入表（未登记即回退既有口径）', () => {
    clearAuthoredClosure()
    recordAuthoredClosure(11, true)
    expect(readAuthoredClosure(11)).toBeUndefined()
  })

  it('非叶子网格不给登记表开口子（先过叶子标记，登记无效）', () => {
    clearAuthoredClosure()
    const s = meshShape(TETRA_POINTS, TETRA_TRIS.slice(0, 9))
    recordAuthoredClosure(13, false)
    expect(isClosedOperandForBooleanOp(stubApi(), 13, s).closed).toBe(true)
    clearAuthoredClosure()
  })

  it('登记表挂在 globalThis（跨包 / 跨副本共享同一份）', () => {
    clearAuthoredClosure()
    recordAuthoredClosure(21, false)
    const g = globalThis as unknown as Record<symbol, unknown>
    expect(g[Symbol.for('faijs.authoredClosure')]).toBeInstanceOf(Map)
    expect(readAuthoredClosure(21)).toBe(false)
    // 非数字 / NaN 句柄读不到结论 ⇒ 回退，不误判
    expect(readAuthoredClosure('21')).toBeUndefined()
    expect(readAuthoredClosure(Number.NaN)).toBeUndefined()
    clearAuthoredClosure()
  })
})

describe('authored-leaf 标记', () => {
  it('标记只在对象上生效，序列化丢失后按未标记处理', () => {
    const s = meshShape(TETRA_POINTS, TETRA_TRIS)
    expect(isAuthoredLeaf(s)).toBe(false)
    markAuthoredLeaf(s)
    expect(isAuthoredLeaf(s)).toBe(true)
    // 结构化克隆（模拟 worker 边界）会丢掉 Symbol 键 ⇒ 退化为未标记（不校验）
    const cloned = structuredClone(s) as Shape
    expect(isAuthoredLeaf(cloned)).toBe(false)
    expect((cloned as Record<symbol, unknown>)[AUTHORED_LEAF]).toBeUndefined()
  })

  it('非对象打标记静默忽略', () => {
    expect(() => markAuthoredLeaf(42)).not.toThrow()
    expect(() => markAuthoredLeaf(null)).not.toThrow()
    expect(isAuthoredLeaf(42)).toBe(false)
  })

  it('ext 叶子 op 白名单：叶子算子在内，派生算子不在', () => {
    for (const op of ['load', 'polyhedron', 'twistExtrude', 'revolve', 'surface', 'text', 'sphere', 'cylinder', 'cone']) {
      expect(EXT_LEAF_OPS.has(op)).toBe(true)
    }
    // 「吃几何再派生」的算子对应 CGAL 的 Nef 阶段，不能当叶子校验
    for (const op of ['hull', 'minkowski', 'resize', 'projectCut', 'projectOutline', 'offset2d', 'polygonBool', 'polygonOffset']) {
      expect(EXT_LEAF_OPS.has(op)).toBe(false)
    }
  })
})
