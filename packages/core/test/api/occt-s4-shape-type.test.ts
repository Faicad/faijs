/**
 * @vitest-environment node
 *
 * occt S4 类型判定谓词族探针（长期保留，可重复跑）——方案 §3.4.6 校正注（类型判定族
 * 已据实测从「中立」校正为「occt 平台 op」，直调 occt 原生 isEdge/isFace/…）。
 *
 * 8 个谓词（isEdge / isFace / isShell / isVertex / isWire / isCompound /
 * isCompSolid / isEqual）返回布尔，走 `api/shape-type/index.ts` 的普通函数形态 +
 * `assertEngineFor('<op>', ['occt'])` 引擎守卫（与 api/export-brep.ts 同口径）。
 *
 * 本文件钉住两条事实：
 *   A. 每种拓扑类型经 occt 原生 is* 直调能正确判别（正例 true、其余 false）；
 *   B. isEqual 同形 true / 异形 false；
 *   C. 非 occt 引擎下每个谓词在触碰内核前抛 E_BREP_UNSUPPORTED（可切换性不破）。
 *
 * Run: npx vitest run test/api/occt-s4-shape-type.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  initOcctWasm, getOcctKernel,
} from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { solidToShape } from '../../src/brep/brep-ops'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { fromBrep, solid } from '../../src/shape'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { Shape } from '../../src/mesh/types'
import {
  isEdge, isFace, isShell, isVertex, isWire, isCompound, isCompSolid, isEqual,
} from '../../src/api/shape-type'

let backends: Backends
// 拓扑 fixture：必须在 beforeAll（configureBackends 之后）构造，describe 收集期
// 尚不能触碰内核（否则报 "backends not configured"）。
let box: Shape, vertex: Shape, edge: Shape, wire: Shape, face: Shape, shell: Shape, compound: Shape

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
  await initOcctWasm()
  const brep = await getBrepEngine()
  backends = {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
  configureBackends(backends)

  // 全部 fixture 经 L1 契约构造（可复现），谓词经 occt 原生 is* 判别。
  box = adopt(getBrepApi().makeBox(10, 10, 10))
  vertex = adopt(getBrepApi().makeVertex(0, 0, 0))
  edge = adopt(getBrepApi().makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }))
  wire = adopt(getBrepApi().makeWire([
    getBrepApi().makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
  ]))
  // 面 fixture 需**闭合** wire（单开线边 makeFace 会 construction failed）。
  const rectEdges = [
    getBrepApi().makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
    getBrepApi().makeLineEdge({ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }),
    getBrepApi().makeLineEdge({ x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }),
    getBrepApi().makeLineEdge({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }),
  ]
  face = adopt(getBrepApi().makeFace(getBrepApi().makeWire(rectEdges)))
  shell = adopt(getBrepApi().getSubShapes(getBrepApi().makeBox(10, 10, 10), 'shell')[0] as BrepHandle)
  compound = adopt(getBrepApi().makeCompound([getBrepApi().makeBox(10, 10, 10)]))
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

/** 内核句柄 → 可进谓词的 faijs Shape（登记 brep 槽，谓词经 brepOf 取回）。 */
function adopt(h: BrepHandle): Shape {
  return fromBrep(solidToShape(getBrepApi(), h), { solid: h })
}

describe('类型判定族 — 各拓扑类型的正例/反例（方案 §3.4.6）', () => {
  it('A. isEdge：边正例 true，实体/面/线/壳/顶点 false', () => {
    expect(isEdge(edge)).toBe(true)
    expect(isEdge(box)).toBe(false)
    expect(isEdge(face)).toBe(false)
    expect(isEdge(wire)).toBe(false)
    expect(isEdge(shell)).toBe(false)
    expect(isEdge(vertex)).toBe(false)
  })

  it('A. isFace：面正例 true，其余 false', () => {
    expect(isFace(face)).toBe(true)
    expect(isFace(box)).toBe(false)
    expect(isFace(edge)).toBe(false)
    expect(isFace(wire)).toBe(false)
    expect(isFace(shell)).toBe(false)
    expect(isFace(vertex)).toBe(false)
  })

  it('A. isWire：线正例 true，其余 false', () => {
    expect(isWire(wire)).toBe(true)
    expect(isWire(box)).toBe(false)
    expect(isWire(edge)).toBe(false)
    expect(isWire(face)).toBe(false)
    expect(isWire(shell)).toBe(false)
    expect(isWire(vertex)).toBe(false)
  })

  it('A. isVertex：顶点正例 true，其余 false', () => {
    expect(isVertex(vertex)).toBe(true)
    expect(isVertex(box)).toBe(false)
    expect(isVertex(edge)).toBe(false)
    expect(isVertex(face)).toBe(false)
    expect(isVertex(wire)).toBe(false)
    expect(isVertex(shell)).toBe(false)
  })

  it('A. isShell：壳正例 true（取自首盒 sub-shape），其余 false', () => {
    expect(isShell(shell)).toBe(true)
    expect(isShell(box)).toBe(false)
    expect(isShell(face)).toBe(false)
    expect(isShell(wire)).toBe(false)
    expect(isShell(vertex)).toBe(false)
  })

  it('A. isCompound：复合体正例 true，其余 false', () => {
    expect(isCompound(compound)).toBe(true)
    expect(isCompound(box)).toBe(false)
    expect(isCompound(face)).toBe(false)
    expect(isCompound(wire)).toBe(false)
    expect(isCompound(vertex)).toBe(false)
  })

  it('A. isCompSolid：实体/复合体均 false（无 makeCompSolid 正例 fixture，仅钉反例）', () => {
    expect(isCompSolid(box)).toBe(false)
    expect(isCompSolid(compound)).toBe(false)
  })

  it('B. isEqual：occt IsEqual 语义（同一几何实体 true，独立构造 false）', () => {
    const a = adopt(getBrepApi().makeBox(10, 10, 10))
    const a2 = adopt(getBrepApi().makeBox(10, 10, 10))
    expect(isEqual(a, a)).toBe(true)   // 同一手柄 / 同一几何实体
    expect(isEqual(a, a2)).toBe(false) // 几何相同但独立构造 → occt IsEqual 为 false（非内容比较）
    expect(isEqual(a, vertex)).toBe(false)
    expect(isEqual(box, compound)).toBe(false)
  })

  it('C. 引擎守卫：非 occt 引擎下每个谓词在触碰内核前抛 E_BREP_UNSUPPORTED', () => {
    configureBackends({
      ...backends,
      config: { ...backends.config, brepEngineId: 'brepkit' },
    } as unknown as Backends)
    try {
      expect(() => isEdge(box)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => isFace(face)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => isShell(shell)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => isVertex(vertex)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => isWire(wire)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => isCompound(compound)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => isCompSolid(box)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => isEqual(box, box)).toThrow(/E_BREP_UNSUPPORTED/)
    } finally {
      // 还原 occt 引擎，避免污染后续用例。
      configureBackends(backends)
    }
  })

  it('D. mesh-only 形状（无 BREP 柄）报 E_SHAPE_TYPE_NO_BREP，而非穿透到 occt', () => {
    // 用 mesh 构造器（无 BREP 槽）造一个纯 mesh 形状；brepOf 返回 undefined。
    const meshOnly = solid({ positions: new Float32Array([]), indices: new Uint32Array([]) })
    expect(() => isEdge(meshOnly)).toThrow(/E_SHAPE_TYPE_NO_BREP/)
  })
})
