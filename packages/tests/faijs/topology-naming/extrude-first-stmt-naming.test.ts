/**
 * extrude 首实体语句命名登记（D13, 2026-10-15）
 *
 * 回归语义（对应 weapp/web「草图拉伸产物无法倒角/选面」根因）：
 * - `cad.sketch + cad.extrude` 且 extrude 是该 execute 的**首个实体语句**时，
 *   实体的 brepkit 0 基句柄可能恰为 0。登记段必须用 `!== undefined` 判定
 *   存在性（禁止真值判断——真值判断会把合法句柄 0 当 falsy 跳过登记，
 *   下游 fillet/chamfer 的 edgeRef 报 nameless shape）。
 * - 断言：faceNaming 角色完整（bottom/top/wall:0..wall:3）+ 12 条边逐条
 *   edgeRef + chamfer 全部成功 + 对照「extrude 前先有 box」（句柄非 0）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { registerBrepkitBrepEngine } from '@faicad/faijs/brep/engine/adapters/brepkit'
import { asPartName } from '@faicad/faijs/identity'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
  await registerBrepkitBrepEngine()
}, 120000)

const SKETCH_EXTRUDE_FIRST_STMT = `
  let sk0 = cad.sketch({ plane: 'XZ', shapes: [{ kind: 'rect', w: 100, d: 60, tag: 'g0' }], constraints: [] })
  let part0 = cad.extrude(sk0, { length: 10, normal: [0, -1, 0] })
`

const BOX_THEN_SKETCH_EXTRUDE = `
  let partA = cad.box(20, 20, 20, { centered: true })
  let sk0 = cad.sketch({ plane: 'XZ', shapes: [{ kind: 'rect', w: 8, d: 8, tag: 'g0' }], constraints: [] })
  let part0 = cad.extrude(sk0, { length: 10, normal: [0, -1, 0] })
`

function faceRolesOf(runtime: CadRuntime, result: ExecutionResult, part: string): string[] {
  const p0 = asPartName(part)
  const naming = result.naming?.get(p0)
  if (!naming) throw new Error(`[D13] ${part} has no naming entry`)
  return naming.faceNaming.map((f) => f.role ?? 'null')
}

describe('D13: extrude first-stmt solid must register role table (0-based handle)', () => {
  for (const engine of ['occt', 'brepkit'] as const) {
    it(`${engine}: sketch+extrude (extrude first entity stmt) → full faceNaming`, async () => {
      const runtime: CadRuntime = createRuntime(createNodePorts(), 'brep')
      try {
        const result: ExecutionResult = await runtime.execute(SKETCH_EXTRUDE_FIRST_STMT, { topology: 'auto' })
        expect(result.failedAt).toBeUndefined()
        const roles = faceRolesOf(runtime, result, 'part0')
        expect(roles).toContain('bottom')
        expect(roles).toContain('top')
        expect(roles.filter((r) => r.startsWith('wall:')).sort()).toEqual(['wall:0', 'wall:1', 'wall:2', 'wall:3'])
      } finally {
        runtime.dispose()
      }
    }, 120000)

    it(`${engine}: box BEFORE sketch+extrude (non-zero handle) → full faceNaming too`, async () => {
      const runtime: CadRuntime = createRuntime(createNodePorts(), 'brep')
      try {
        const result: ExecutionResult = await runtime.execute(BOX_THEN_SKETCH_EXTRUDE, { topology: 'auto' })
        expect(result.failedAt).toBeUndefined()
        const roles = faceRolesOf(runtime, result, 'part0')
        expect(roles.filter((r) => r.startsWith('wall:')).sort()).toEqual(['wall:0', 'wall:1', 'wall:2', 'wall:3'])
      } finally {
        runtime.dispose()
      }
    }, 120000)
  }

  it('brepkit: every edge of sketch-extruded part0 is edgeRef+chamfer-able', async () => {
    const runtime: CadRuntime = createRuntime(createNodePorts(), 'brep')
    try {
      const base: ExecutionResult = await runtime.execute(SKETCH_EXTRUDE_FIRST_STMT, { topology: 'auto' })
      expect(base.failedAt).toBeUndefined()
      const solid = base.brepSolids?.get(asPartName('part0'))?.solid
      const kernel = base.brepChain.kernel
      const edgeCount = solid && kernel
        ? (kernel as unknown as { getSubShapes: (s: unknown, t: string) => unknown[] }).getSubShapes(solid, 'edge').length
        : 0
      expect(edgeCount).toBeGreaterThan(0)
      const fails: string[] = []
      for (let n = 1; n <= edgeCount; n++) {
        const r2 = createRuntime(createNodePorts(), 'brep')
        try {
          const code = `${SKETCH_EXTRUDE_FIRST_STMT}\n  let part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, ${n})], type: 'equal', width: 1 })`
          const res: ExecutionResult = await r2.execute(code, { topology: 'auto' })
          if (res.failedAt) fails.push(`${n}: ${res.failedAt.code}: ${res.failedAt.message}`)
        } finally {
          r2.dispose()
        }
      }
      expect(fails).toEqual([])
    } finally {
      runtime.dispose()
    }
  }, 240000)
})
