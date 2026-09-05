/**
 * P4 · L3 端到端（docs/plans/2026-09-01-layered-api-architecture.md §8 P4）
 *
 * 首个端到端验证点：「defineOp 扩展 consumes/schema 字段（D2）」+「只接 3 个 op
 * （box/cylinder/union）打通 `.fai.js` → 执行 → terminals → 宿主」。
 *
 * 三层验证：
 * 1) 宿主链路（宿主同款消费路径）：CadRuntime.execute(code) 文本执行 3 个 op，
 *    断言 ExecutionResult 关键字段（terminals/naming/brepSolids/topology 等，防静默降级）
 *    与 terminals 推导。union 的输入按既有 R5 语义保留为 hidden 终端。
 * 2) C2 静态 consumes 直通：第三方案 operator（consumes:'none'）经 runtime 注册后，
 *    terminal-dag 的运行时视图（stmt → libs[ns][callee] → DUAL_OP_META.consumes）
 *    读取声明，上游 shape 不被消费 → 独立终端；缺省（C5）则被消费。
 * 3) D2 元数据面：schema/consumes 随 defineOp 挂载，供工具链（codegen/UI 面板）取用；
 *    现网 stdlib 的 box/cylinder/union 已带声明。
 *
 * Run: npx vitest run faijs/p4-l3-e2e/p4-l3-e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { createRuntime as coreCreateRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import type { ExecutionResult } from '@faicad/faijs-core/cad-runtime/runtime'
import { DUAL_OP_META, CONTRACT_VERSION, defineOp } from '@faicad/faijs-core/sdk'
import type { StdlibNamespace } from '@faicad/faijs-core/runtime-state'
import { box as stdlibBox, cylinder as stdlibCylinder, union as stdlibUnion } from '@faicad/faijs-core/api'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'

/** 最小 cube mesh（测试专用轻量实现，不启动内核）。 */
function cubeMesh(size: number): Shape {
  const s = size / 2
  return {
    positions: new Float32Array([
      -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
      -s, -s, s, s, -s, s, s, s, s, -s, s, s,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]),
  }
}

beforeAll(async () => {
  // BREP 宿主链路需要真实 occt 内核（D10 经根门面注入）。
  await registerOcctBrepEngine()
}, 120000)

const P0 = asPartName('part0')
const P1 = asPartName('part1')

describe('P4· 宿主链路 end-to-end（.fai.js → execute → terminals → ExecutionResult）', () => {
  it('box + cylinder + union 执行成功：terminals/naming/brepSolids/topology 齐全', async () => {
    const rt = createRuntime(createNodePorts(), 'brep')
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.cylinder(6, 30, { centered: true })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')
    const result: ExecutionResult = await rt.execute(code)
    try {
      expect(result.failedAt).toBeUndefined()

      // outputs：三个变量都在
      expect(result.outputs.has(P0)).toBe(true)
      expect(result.outputs.has(P1)).toBe(true)
      expect(result.outputs.has(asPartName('part2'))).toBe(true)

      // terminals：union 结果可见；输入按既有 R5 语义保留为 hidden 终端
      const terms = result.terminals.map((t) => String(t.id))
      expect(terms).toContain('part2')
      const byId = new Map(result.terminals.map((t) => [String(t.id), t]))
      expect(byId.get('part0')?.hidden).toBe(true)
      expect(byId.get('part1')?.hidden).toBe(true)
      const term0 = result.terminals.find((t) => String(t.id) === 'part0')
      const term1 = result.terminals.find((t) => String(t.id) === 'part1')
      expect(term0?.hidden).toBe(true)
      expect(term1?.hidden).toBe(true)

      // naming：行为反查命名的宿主依赖 → 至少含三行
      const naming = result.naming
      expect(naming).toBeDefined()
      expect(naming!.size).toBeGreaterThanOrEqual(3)
      expect(naming!.has(P0)).toBe(true)
      expect(naming!.has(P1)).toBe(true)

      // brepSolids / topology：BREP 模式产物就绪
      expect(result.brepSolids!.get(asPartName('part2'))?.solid).toBeDefined()
      expect(result.topology!.get(asPartName('part2'))).toBeDefined()

      // ExecutionResult 关键字段逐一在场（防静默删减）
      for (const key of [
        'outputs',
        'brepChain',
        'terminals',
        'infos',
        'naming',
        'changed',
        'activeValues',
        'compounds',
      ]) {
        expect(key in result, `missing ExecutionResult field ${key}`).toBe(true)
      }
    } finally {
      rt.dispose()
    }
  })
})

describe('P4·C2 静态 consumes 经 runtime libs 注册表驱动 terminals', () => {
  function lib(ops: Record<string, unknown>): StdlibNamespace {
    return { ...ops, contractVersion: CONTRACT_VERSION } as unknown as StdlibNamespace
  }

  it('consumes "none"：上游不被吞 → origin 与 probe 都是独立终端', async () => {
    const probe = defineOp({ mesh: (_s: Shape) => cubeMesh(1), consumes: 'none', schema: { input: 'Shape' } })
    const box = defineOp({ mesh: (_p: Record<string, unknown>) => cubeMesh(20) })
    const rt = coreCreateRuntime(createNodePorts(), 'auto', { cad: lib({ box, probe }) })
    const result: ExecutionResult = await rt.execute('let part0 = cad.box(20, 20, 20, { centered: true })\nlet part1 = cad.probe(part0)')
    try {
      const terms = result.terminals.map((t) => String(t.id)).sort()
      expect(terms).toEqual(['part0', 'part1'])
    } finally {
      rt.dispose()
    }
  })

  it('缺省（无 consumes / C5）：上游被消费，只剩末位终端', async () => {
    const absorb = defineOp({ mesh: (_s) => cubeMesh(1) })
    const box = defineOp({ mesh: (_p: Record<string, unknown>) => cubeMesh(20) })
    const rt = coreCreateRuntime(createNodePorts(), 'auto', { cad: lib({ box, absorb }) })
    const result: ExecutionResult = await rt.execute('let part0 = cad.box(20, 20, 20, { centered: true })\nlet part1 = cad.absorb(part0)')
    try {
      const terms = result.terminals.map((t) => String(t.id))
      expect(terms).toEqual(['part1'])
    } finally {
      rt.dispose()
    }
  })
})

describe('P4·D2 元数据装配（codegen / UI 面板取用面）', () => {
  it('stdlib box/cylinder 声明 consumes "none"+ schema；union 声明 "all"', () => {
    const metaOf = (fn: unknown): NonNullable<{ [DUAL_OP_META]?: { consumes?: unknown; schema?: unknown } }[typeof DUAL_OP_META]> => {
      const meta = (fn as { [DUAL_OP_META]?: { consumes?: unknown; schema?: unknown } })[DUAL_OP_META]
      expect(meta).toBeDefined()
      return meta!
    }
    const boxMeta = metaOf(stdlibBox)
    expect(boxMeta.consumes).toBe('none')
    // §4.1 新契约：box(width, depth, height, { at?, centered?, segments? })
    expect(boxMeta.schema).toEqual({
      width: 'number',
      depth: 'number',
      height: 'number',
      at: 'vec3?',
      centered: 'boolean?',
      segments: 'number?',
    })

    const cylMeta = metaOf(stdlibCylinder)
    expect(cylMeta.consumes).toBe('none')
    expect(cylMeta.schema).toHaveProperty('radius')

    const unionMeta = metaOf(stdlibUnion)
    expect(unionMeta.consumes).toBe('all')
  })
})