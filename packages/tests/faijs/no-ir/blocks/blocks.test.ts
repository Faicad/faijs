/**
 * T1 / A-6 / A-11：自由 JS 块执行（DirectExecutor + computeLiveShapes）
 *
 * 验收：
 * - A-6 for 块在 timeline 显示为单个只读节点（用 extractMetadata 断言）；
 *   块内产出的 shape 出现在 terminals（ctx diff → blockOutputs → computeLiveShapes）；
 *   块在 timeline 单只读节点（不展开、不聚合、不分析内部语义）。
 * - A-11 自由语法回归：循环块 / 条件块 / 嵌套块。
 *
 * 环境：mesh 模式；用一次 warmup execute 认领全局 backends。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import { DirectExecutor } from '@faicad/faijs-core/cad-runtime/direct-executor'
import { computeLiveShapes, keepViewFromMetadata } from '@faicad/faijs-core/cad-runtime/live-shapes'
import { extractMetadata } from '@faicad/faijs-core/lang/metadata-extractor'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import { isMeshShape } from '@faicad/faijs-core/mesh/types'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import type { HostPorts } from '@faicad/faijs-core/cad-runtime/ports'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

describe('A-6: for 块 — 块内 shape 进 terminals，timeline 单只读节点', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it('for 循环产出多个 shape，全部进 ctx 且 terminals 含存活者', async () => {
    const code = [
      'let base = cad.box(40, 40, 10, { centered: true })',
      'for (let i = 0; i < 3; i++) {',
      '  const hole = cad.cylinder(5, 10, { centered: true, segments: 24 })',
      '  base = cad.subtract(base, hole)',
      '}',
    ].join('\n')

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute(code)
    expect(out.failedAt).toBeUndefined()
    expect(isMeshShape(ex.ctx.base)).toBe(true)

    // 块内产出 hole 应在 blockOutputs 里登记
    const blockOutputs = out.blockOutputs
    expect(blockOutputs).toBeDefined()
    expect(blockOutputs!.has('hole')).toBe(true)
    expect(blockOutputs!.get('hole')).toBe(2) // 块起始行 = 2

    // 元数据：for 块是单个只读节点（blocks[0]），不进 lines
    const meta = extractMetadata(code)
    expect(meta.blocks).toHaveLength(1)
    expect(meta.blocks[0].kind).toBe('loop')
    expect(meta.blocks[0].astKind).toBe('ForStatement')
    expect(meta.lines.filter((l) => l.line === 2)).toHaveLength(0)

    // computeLiveShapes：base 是最后写者（块内重赋值），存活
    const shapeVarNames = new Set<PartName>()
    for (const l of meta.lines) for (const o of l.outputs) shapeVarNames.add(o)
    // base 在 lines 里有产出（行1+行3重赋值），hole 在 blockOutputs 里
    shapeVarNames.add(asPartName('base'))
    shapeVarNames.add(asPartName('hole'))

    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepViewFromMetadata(meta),
      shapeVarNames,
      blockOutputs,
    })
    const ids = terminals.map((t) => String(t.id))
    expect(ids).toContain('base')
  })

  it('for 循环块内产出独立 shape（不被消费）→ 出现在 terminals', async () => {
    const code = [
      'for (let i = 0; i < 2; i++) {',
      '  const part = cad.box(10, 10, 10, { centered: true })',
      '}',
    ].join('\n')

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute(code)
    expect(out.failedAt).toBeUndefined()

    // 块内产出 part → blockOutputs 登记行=1（块起始行）
    expect(out.blockOutputs).toBeDefined()
    expect(out.blockOutputs!.has('part')).toBe(true)
    expect(out.blockOutputs!.get('part')).toBe(1)

    // 元数据：for 块是单个只读节点
    const meta = extractMetadata(code)
    expect(meta.blocks).toHaveLength(1)
    expect(meta.blocks[0].kind).toBe('loop')
    expect(meta.lines).toHaveLength(0) // 块内不进 lines

    // part 在 ctx 中（块执行后），应作为终端
    const shapeVarNames = new Set<PartName>([asPartName('part')])
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepViewFromMetadata(meta),
      shapeVarNames,
      blockOutputs: out.blockOutputs,
    })
    const ids = terminals.map((t) => String(t.id))
    expect(ids).toContain('part')
  })
})

describe('A-11: 自由语法回归 — 条件块 / 嵌套块', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it('if 块：条件成立时执行块内 shape 产出', async () => {
    const code = [
      'const makeHole = true',
      'let base = cad.box(30, 30, 10, { centered: true })',
      'if (makeHole) {',
      '  const hole = cad.cylinder(5, 10, { centered: true, segments: 24 })',
      '  base = cad.subtract(base, hole)',
      '}',
    ].join('\n')

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute(code)
    expect(out.failedAt).toBeUndefined()
    expect(isMeshShape(ex.ctx.base)).toBe(true)

    const meta = extractMetadata(code)
    expect(meta.blocks).toHaveLength(1)
    expect(meta.blocks[0].kind).toBe('condition')
    expect(meta.blocks[0].astKind).toBe('IfStatement')

    // hole 在 blockOutputs 里（块起始行=3）
    expect(out.blockOutputs!.has('hole')).toBe(true)
    expect(out.blockOutputs!.get('hole')).toBe(3)
  })

  it('嵌套块：for 内嵌 if，内层 shape 进 ctx', async () => {
    const code = [
      'let result = cad.box(50, 50, 10, { centered: true })',
      'for (let i = 0; i < 2; i++) {',
      '  if (i > 0) {',
      '    const extra = cad.box(5, 5, 5, { centered: true })',
      '    result = cad.union(result, extra)',
      '  }',
      '}',
    ].join('\n')

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute(code)
    expect(out.failedAt).toBeUndefined()
    expect(isMeshShape(ex.ctx.result)).toBe(true)

    // extra 产出在 blockOutputs 里（外层 for 块起始行=2）
    expect(out.blockOutputs!.has('extra')).toBe(true)
    expect(out.blockOutputs!.get('extra')).toBe(2)

    // 元数据：for + if 两个只读块节点
    const meta = extractMetadata(code)
    expect(meta.blocks.length).toBeGreaterThanOrEqual(1)
    // for 块
    const forBlock = meta.blocks.find((b) => b.astKind === 'ForStatement')
    expect(forBlock).toBeDefined()
  })

  it('while 循环：产出 shape 进 ctx', async () => {
    const code = [
      'let i = 0',
      'let acc = cad.box(10, 10, 10, { centered: true })',
      'while (i < 2) {',
      '  const piece = cad.box(5, 5, 5, { centered: true })',
      '  acc = cad.union(acc, piece)',
      '  i = i + 1',
      '}',
    ].join('\n')

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute(code)
    expect(out.failedAt).toBeUndefined()
    expect(isMeshShape(ex.ctx.acc)).toBe(true)
    expect(out.blockOutputs!.has('piece')).toBe(true)
    expect(out.blockOutputs!.get('piece')).toBe(3) // while 块起始行
  })
})

describe('A-6: append 后的块行号稳定（整段重放）', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it('append for 块：块起始行号 = append 后全文中的行号', async () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const first = await ex.execute('let bp = cad.box(20, 20, 20, { centered: true })')
    expect(first.failedAt).toBeUndefined()

    const blockCode = [
      'for (let i = 0; i < 1; i++) {',
      '  const hole = cad.cylinder(3, 10, { centered: true, segments: 24 })',
      '  bp = cad.subtract(bp, hole)',
      '}',
    ].join('\n')

    const second = await ex.append(blockCode)
    expect(second.failedAt).toBeUndefined()
    // 块起始行在全文中是第 2 行（第一行是 bp 声明）
    expect(second.blockOutputs!.has('hole')).toBe(true)
    expect(second.blockOutputs!.get('hole')).toBe(2)
  })
})
