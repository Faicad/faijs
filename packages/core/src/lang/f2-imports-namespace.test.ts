/**
 * F2 — 顶层 import 段 + 多命名空间调用（normal-js-subset P2/P3 验收）
 *
 *
 * 验收判据（§5.4）：
 * - `import * as mech from 'gear-lib-demo'` + `mech.makeHeadstock(...)` → parse → codegen
 *   → parse 往返逐位相等（含 import 段与命名空间前缀）。
 * - mock 库端到端执行成功：产物进 ExecutionResult.outputs，与内置 op 产物可混合 cad.union。
 * - 未登记 specifier 的命名空间调用 → check ② 明确报错（不回退、不静默）。
 * - statementKey：`cad.chamfer` ≠ `gear-lib-demo.chamfer`（包名前缀）。
 */

import { describe, it, expect } from 'vitest'
import { parseScript, ParseError } from './parser'
import { scriptIRToCode } from './codegen'
import { analyzeCode } from './statement-summary'
import { statementInputs } from './types'
import { createRuntime } from '@faicad/faijs'
import type { HostPorts, EventSink } from '../cad-runtime/ports'
import { solid } from '../shape'
import type { Shape } from '../mesh/types'
import { asPartName } from '../identity'

// ── 测试辅助 ──

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

function createNodePorts(): HostPorts {
  return { events: new TestEventSink() }
}

/** 最小立方体 mesh（mock 第三方库用；与 runtime.test.ts P7 同款，保证流形）。 */
function cubeMesh(size: number): Shape {
  const s = size / 2
  const positions = new Float32Array([
    -s, -s, -s,  s, -s, -s,  s, s, -s,  -s, s, -s,
    -s, -s,  s,  s, -s,  s,  s, s,  s,  -s, s,  s,
  ])
  const indices = new Uint32Array([
    // -X: 0,4,7 / 0,7,3 ; +X: 1,2,6 / 1,6,5
    0, 4, 7,  0, 7, 3,  1, 2, 6,  1, 6, 5,
    // -Y: 0,1,5 / 0,5,4 ; +Y: 3,7,6 / 3,6,2
    0, 1, 5,  0, 5, 4,  3, 7, 6,  3, 6, 2,
    // +Z: 4,5,6 / 4,6,7 ; -Z: 0,3,2 / 0,2,1
    4, 5, 6,  4, 6, 7,  0, 3, 2,  0, 2, 1,
  ])
  return { positions, indices }
}

// ── 往返（parse → codegen → parse） ──

describe('F2: import + 命名空间往返', () => {
  it('import * as mech + mech.makeHeadstock → 往返保留 import 段与命名空间前缀', () => {
    const code = [
      "import * as mech from 'gear-lib-demo'",
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = mech.makeHeadstock({ teeth: 8 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.imports).toEqual([{ specifier: 'gear-lib-demo', kind: 'namespace', localName: 'mech', packageName: 'gear-lib-demo' }])
    const headstock = script.statements[1]
    expect(headstock.callee).toBe('makeHeadstock')
    expect(headstock.namespace).toBe('mech')
    expect(statementInputs(headstock)).toEqual([])

    const regenerated = scriptIRToCode(script)
    expect(regenerated.startsWith("import * as mech from 'gear-lib-demo'\n")).toBe(true)
    expect(regenerated).toContain('mech.makeHeadstock({ teeth:8 })')

    const reparsed = parseScript(regenerated).script
    expect(reparsed.imports).toEqual(script.imports)
    expect(reparsed.statements[1].namespace).toBe('mech')
    expect(reparsed.statements[1].callee).toBe('makeHeadstock')
    expect(reparsed.statements[1].args).toEqual(script.statements[1].args)
    expect(reparsed.statements[2].callee).toBe('union')
    expect(statementInputs(reparsed.statements[2])).toEqual(['part0', 'part1'])
  })

  it('命名空间输入解析：mech.op(part0) 的 input 是已声明变量', () => {
    const code = [
      "import * as mech from 'gear-lib-demo'",
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = mech.engrave(part0, { depth: 2 })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[1].namespace).toBe('mech')
    expect(statementInputs(script.statements[1])).toEqual(['part0'])
  })

  it('named / default import 往返保真', () => {
    const code = [
      "import { makeHeadstock, gear } from 'gear-lib-demo'",
      "import spec from 'bearing-db'",
      'let part0 = cad.box(20, 20, 20, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.imports?.[0]).toEqual({ specifier: 'gear-lib-demo', kind: 'named', localName: 'makeHeadstock', bindings: ['makeHeadstock', 'gear'], packageName: 'gear-lib-demo' })
    expect(script.imports?.[1]).toEqual({ specifier: 'bearing-db', kind: 'default', localName: 'spec', packageName: 'bearing-db' })

    const regenerated = scriptIRToCode(script)
    expect(regenerated).toContain("import { makeHeadstock, gear } from 'gear-lib-demo'")
    expect(regenerated).toContain("import spec from 'bearing-db'")

    const reparsed = parseScript(regenerated).script
    expect(reparsed.imports).toEqual(script.imports)
  })

  it('@scope 包名推导：@faicad/mech/sub → @faicad/mech', () => {
    const code = [
      "import * as mech from '@faicad/mech/sub'",
      'let part0 = mech.makeHeadstock()',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.imports?.[0].packageName).toBe('@faicad/mech')
    expect(script.statements[0].namespace).toBe('mech')
  })

  it('语句行号偏移：import 占 1 行，首条语句 line = 2', () => {
    const code = [
      "import * as mech from 'gear-lib-demo'",
      'let part0 = cad.box(20, 20, 20, { centered: true })',
    ].join('\n')
    const { script, statementLines } = parseScript(code)
    expect(statementLines).toEqual([2])
    expect(script.statements[0].callee).toBe('box')
  })

  it('嵌套第三方调用 → CallRefIR.namespace', () => {
    const code = [
      "import * as mech from 'gear-lib-demo'",
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.fai_drill(part0, { at: mech.holeCenter(part0) })',
    ].join('\n')
    const { script } = parseScript(code)
    const atArg = script.statements[1].args.at
    expect(atArg).toEqual({ $call: { callee: 'holeCenter', args: [{ $ref: 'part0' }], namespace: 'mech' } })
  })

  it('StatementSummary 带 namespace/packageName（timeline「带包名」标识来源）', () => {
    const code = [
      "import * as mech from 'gear-lib-demo'",
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = mech.makeHeadstock()',
    ].join('\n')
    const summaries = analyzeCode(code)
    expect(summaries[0].namespace).toBeUndefined()
    expect(summaries[0].packageName).toBeUndefined()
    expect(summaries[1].namespace).toBe('mech')
    expect(summaries[1].packageName).toBe('gear-lib-demo')
  })
})

// ── import 约束（E_IMPORT） ──

describe('F2: import 约束', () => {
  it('import 不在文件头部 → E_IMPORT', () => {
    let err: ParseError | undefined
    try {
      parseScript("let part0 = cad.box(20, 20, 20, { centered: true })\nimport * as mech from 'gear-lib-demo'")
    } catch (e) {
      err = e as ParseError
    }
    expect(err).toBeInstanceOf(ParseError)
    expect(err!.code).toBe('E_IMPORT')
  })

  it('import 之间夹语句 → E_IMPORT', () => {
    let err: ParseError | undefined
    try {
      parseScript("import * as a from 'a'\nlet part0 = cad.box(20, 20, 20, { centered: true })\nimport * as b from 'b'")
    } catch (e) {
      err = e as ParseError
    }
    expect(err!.code).toBe('E_IMPORT')
  })

  it('副作用 import（import "x"）→ E_IMPORT', () => {
    let err: ParseError | undefined
    try {
      parseScript("import 'gear-lib-demo'\nlet part0 = cad.box(20, 20, 20, { centered: true })")
    } catch (e) {
      err = e as ParseError
    }
    expect(err!.code).toBe('E_IMPORT')
  })

  it('动态 import() 仍报 E_CONTROL_FLOW（import 段之外）', () => {
    let err: ParseError | undefined
    try {
      parseScript('let part0 = await import("gear-lib-demo")')
    } catch (e) {
      err = e as ParseError
    }
    expect(err!.code).toBe('E_CONTROL_FLOW')
  })

  it('export 仍被拒绝（E_STATEMENT）', () => {
    let err: ParseError | undefined
    try {
      parseScript("import * as mech from 'gear-lib-demo'\nexport const x = 1")
    } catch (e) {
      err = e as ParseError
    }
    expect(err!.code).toBe('E_STATEMENT')
  })
})

// ── 端到端：mock 库执行 + 与内置 op 混合 ──

describe('F2: mock 库端到端执行', () => {
  // mesh 模式：两条路径都是纯 manifold 网格。auto 模式的 BREP 链产物 × mesh-only
  // 混合 union 是已知兼容缺口（landing 文档 §5-2 D11），不属于 F2 通道验证范围
  // （与 runtime.test.ts P7 混合用例同款取舍）。
  function makeMeshRuntime() {
    return createRuntime(createNodePorts(), 'mesh')
  }

  it('registerLib + import 脚本 → mech.makeHeadstock 产物与 cad.union 混合成功', async () => {
    const runtime = makeMeshRuntime()
    runtime.registerLib('mech', {
      makeHeadstock: () => solid(cubeMesh(8)),
    }, { packageName: 'gear-lib-demo' })

    const code = [
      "import * as mech from 'gear-lib-demo'",
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'let part1 = mech.makeHeadstock({ teeth: 8 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')
    const result = await runtime.execute(code)
    expect(result.failedAt).toBeUndefined()
    expect(result.outputs.size).toBeGreaterThan(0)
    // 混合产物在场：union 结果可见
    expect([...result.outputs.keys()].some((p) => p === asPartName('part2'))).toBe(true)
    runtime.dispose()
  })

  it('statementKey 含包名前缀：cad.box ≠ mech.box 不碰撞', async () => {
    const runtime = makeMeshRuntime()
    runtime.registerLib('mech', {
      box: (params: { size: number }) => solid(cubeMesh(params.size)),
    }, { packageName: 'gear-lib-demo' })
    const code = [
      "import * as mech from 'gear-lib-demo'",
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'let part1 = mech.box(10, 10, 10, { centered: true })',
    ].join('\n')
    const result = await runtime.execute(code)
    expect(result.failedAt).toBeUndefined()
    const key0 = runtime.getStatementCacheEntry(asPartName('part0'))?.statementKey ?? ''
    const key1 = runtime.getStatementCacheEntry(asPartName('part1'))?.statementKey ?? ''
    expect(key0.startsWith('cad.box#')).toBe(true)
    expect(key1.startsWith('mech.box#')).toBe(true)
    expect(key0).not.toBe(key1)
    runtime.dispose()
  })

  it('未登记 specifier 的命名空间调用 → check ①.5 明确报错（不回退、不静默）', () => {
    const runtime = createRuntime(createNodePorts())
    const res = runtime.check("import * as mech from 'gear-lib-demo'\nlet part0 = mech.makeHeadstock()")
    expect(res.ok).toBe(false)
    const err = res.errors.find((e) => e.stage === 'symbol')
    expect(err).toBeDefined()
    expect(err!.message).toMatch(/import specifier "gear-lib-demo" is not registered/)
    runtime.dispose()
  })

  it('已登记库但 callee 不存在 → check ② 报函数不存在', () => {
    const runtime = createRuntime(createNodePorts())
    runtime.registerLib('mech', { makeHeadstock: () => solid(cubeMesh(1)) }, { packageName: 'gear-lib-demo' })
    const res = runtime.check("import * as mech from 'gear-lib-demo'\nlet part0 = mech.nope()")
    expect(res.ok).toBe(false)
    const err = res.errors.find((e) => e.stage === 'symbol')
    expect(err!.message).toMatch(/does not exist in namespace "mech"/)
    runtime.dispose()
  })
})
