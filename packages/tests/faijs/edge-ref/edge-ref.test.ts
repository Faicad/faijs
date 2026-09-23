/**
 * M6.1 edge-anchor e2e (.fai.js, BREP-only) — `cad.edgeRef(shape, N)` → EdgeTopoRef
 *
 * 验证「序号选边」端到端可用：`cad.edgeRef` 在内核现场把第 N 条边解析成
 * 相邻两面的 role 对（EdgeTopoRef），直接喂给 `cad.chamfer` / `cad.fillet`。
 * 这是 FCStd 移植 `PartDesign::Fillet` / `Chamfer`（FreeCAD 只给 `EdgeN`）的锚点。
 *
 * 数值断言用 20³ 中心立方体：任一条棱倒角 `width=1` 都削掉 ½·w²·L = 10
 * （与 packages/tests/faijs/chamfer/chamfer.test.ts 的 T-A4 同口径），
 * 故断言与「第 N 条边具体是哪条」无关，只依赖序号解析本身。
 *
 * stderr 零容忍（CI 强制）：故意失败用例内 spy console.warn/error 并断言未被调用。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { asPartName, type PartName } from '@faicad/faijs/identity'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

function solidOf(result: ExecutionResult, partName: PartName): BrepHandle {
  const solid = result.brepChain.solidCache.get(partName) as BrepHandle | undefined
  if (!solid) throw new Error('no BREP solid')
  return solid
}

function volumeOf(result: ExecutionResult, partName: PartName): number {
  const kernel = result.brepChain.kernel as BrepEngineApi
  return kernel.getVolume(solidOf(result, partName))
}

function faceCountOf(result: ExecutionResult, partName: PartName): number {
  const kernel = result.brepChain.kernel as BrepEngineApi
  return kernel.getSubShapes(solidOf(result, partName), 'face').length
}

describe('cad.edgeRef e2e (BREP/OCCT)', () => {
  let runtime: CadRuntime

  beforeEach(() => {
    runtime = createRuntime(createNodePorts(), 'brep')
  })

  afterEach(() => {
    runtime.dispose()
  })

  it('resolves edge 1 of a box and chamfers it (face 6→7, removed volume 10)', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 1)], type: 'equal', width: 1 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
    expect(8000 - volumeOf(result, asPartName('part1'))).toBeCloseTo(10, 6)
  })

  it('resolves the last edge ordinal (12) of a box', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 12)], type: 'equal', width: 1 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
    expect(8000 - volumeOf(result, asPartName('part1'))).toBeCloseTo(10, 6)
  })

  it('feeds cad.fillet from an edge anchor', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.fillet(part0, { edges: [cad.edgeRef(part0, 1)], radius: 2 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
    // rounded corner removes ¼-circle of material: (1 − π/4)·r²·L
    expect(8000 - volumeOf(result, asPartName('part1'))).toBeCloseTo((1 - Math.PI / 4) * 4 * 20, 6)
  })

  it('chamfers several anchored edges in one call', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 1), cad.edgeRef(part0, 2)], type: 'equal', width: 1 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    // two parallel edges of the cube → 6 + 2 chamfer faces
    expect(faceCountOf(result, asPartName('part1'))).toBe(8)
  })

  it('fails explicitly when the edge ordinal is out of range', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 999)], type: 'equal', width: 1 })
    `
    try {
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      // naming-layer convention: the code rides on failedAt.code, the message is prose
      expect(result.failedAt!.code).toBe('E_TOPO_NOT_FOUND')
      expect(result.failedAt!.message).toMatch(/out of range \[1, 12\]/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-positive edge ordinal', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 0)], type: 'equal', width: 1 })
    `
    try {
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.code).toBe('E_TOPO_NOT_FOUND')
      expect(result.failedAt!.message).toMatch(/edgeOrdinal must be an integer >= 1/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

/**
 * E3 后续（2026-09-21）——命名链不得在**产形 op** 处断掉。
 *
 * 现场：FCStd 移植的 Pad/Fillet 链是 `sketch → extrude → fillet(edgeRef(extrude_out, N))`。
 * 修复前 `cad.extrude` 产出的 Shape 不带 roleTable（`primitives.ts` 建表、`import_brep`
 * 建表、boolean/fillet/chamfer/copy/place 都传播，只有 extrude 全程没有），于是
 * `cad.edgeRef` 直接抛 `… input shape has no role table (nameless shape)`：
 *
 *   - `strange_part_with_holes.fcstd`（CAM DemoParts）整链死在 s2 的 edgeRef；
 *   - `ModelFromV021.FCStd`（PartDesign）死在 revolve 产物的 edgeRef。
 *
 * 这不是「加个开关让失败的通过」：面命名是**能力**（产形 op 必须给面命名，否则
 * 下游任何按面/边的引用都不可解析），extrude 只是从来没人给它建表。
 *
 * 仍存的同类缺口（未修，见下）：`cad.revolve` 是**生成投影**（compat op），代码里
 * 没有可以挂命名的位置——修它要么手写 revolve op（像 extrude 这样包住投影），
 * 要么在调度层给所有 brep 产物兜底建表，两者都是设计决定，不在本次范围。
 */
describe('naming chain across cad.extrude (E3 后续)', () => {
  let runtime: CadRuntime

  /** 10×10 正方形轮廓（与 FCStd 生成脚本同形）。 */
  const SQUARE = `{ contours: [{ segments: [
    { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
    { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
    { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
  ], closed: true }] }`

  beforeEach(() => {
    runtime = createRuntime(createNodePorts(), 'brep')
  })

  afterEach(() => {
    runtime.dispose()
  })

  it('GOTCHA: an extrude result carries a role table, so edgeRef resolves on it', async () => {
    const code = `
      const part0 = cad.sketch(${SQUARE})
      const part1 = cad.extrude(part0, [0, 0, 10])
      const e = cad.edgeRef(part1, 2)
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
  })

  it('drives the FCStd Pad→Fillet shape: fillet(edgeRef(extrude(sketch)))', async () => {
    const code = `
      const part0 = cad.sketch(${SQUARE})
      const part1 = cad.extrude(part0, [0, 0, 10])
      const part2 = cad.fillet(part1, { edges: [cad.edgeRef(part1, 2)], radius: 1 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(faceCountOf(result, asPartName('part2'))).toBe(7)
    // a straight edge of length 10 loses the corner square minus a quarter disc
    expect(1000 - volumeOf(result, asPartName('part2'))).toBeCloseTo((1 - Math.PI / 4) * 1 * 10, 6)
  })

  it('keeps the table across cad.place (FCStd emits place between features)', async () => {
    const code = `
      const part0 = cad.sketch(${SQUARE})
      const part1 = cad.extrude(part0, [0, 0, 10])
      const part2 = cad.place(part1, { position: [0, 0, 5] })
      const e = cad.edgeRef(part2, 2)
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
  })

  it('revolve result carries a role table (E3 fixed via hand-written wrapper)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // GOTCHA (2026-09-23): the ORIGINAL tripwire revolved the XY-plane square
    // around the Z axis — every point traces a circle in its own z=0 plane, so
    // the product is DEGENERATE (zero height, 1 face) and "edge 1 with two
    // adjacent faces" doesn't exist. It used to die at "no role table" before
    // the geometry mattered; with the table in place the geometry must be a
    // real solid of revolution: revolving the square around the X axis yields
    // a solid cylinder (lateral + 2 caps = 3 faces).
    const code = `
      const part0 = cad.sketch(${SQUARE})
      const part1 = cad.revolve(part0, { axis: [1, 0, 0], at: [0, 0, 0], angle: 6.283185307179586 })
      const e = cad.edgeRef(part1, 1)
    `
    try {
      const result = await runtime.execute(code, { topology: 'auto' })
      // Tripwire FLIPPED (2026-09-23, Q13 route ①): `cad.revolve` is now a
      // hand-written wrapper (`api/revolve.ts`) that registers a chain-root
      // roleTable like extrude/import_brep — edgeRef must resolve, not fail
      // with "no role table". The old nameless behavior is pinned by
      // api/revolve.test.ts (contract level).
      expect(result.failedAt).toBeUndefined()
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
