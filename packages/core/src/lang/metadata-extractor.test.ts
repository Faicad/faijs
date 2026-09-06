/**
 * metadata-extractor — UiMetadata 提取器单元测试
 *
 * 覆盖：op/param/import/function/block 行分类；lines 面与现状 analyzeCode
 * 语义一致（id = 's'+lineNo）；keep 表；容器/扁平行号语义。完整对拍在
 * packages/tests/faijs/no-ir/parity/（A-16，fixture 全集）。
 */

import { describe, it, expect } from 'vitest'
import { extractMetadata } from './metadata-extractor'
import { analyzeCode } from './statement-summary'
import { asStmtId } from '../identity'

describe('extractMetadata: 行分类与表', () => {
  it('扁平 op 行 → lines；参数行 → params（不进 lines）', () => {
    const code = [
      'const size = 20',
      'let part0 = cad.box(size, size, size, { centered: true })',
      'let part1 = cad.translate(part0, { offset: [5, 0, 0] })',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines).toHaveLength(2)
    expect(meta.params).toHaveLength(1)
    expect(meta.params[0]).toMatchObject({ name: 'size', value: 20, computed: false })
    expect(meta.lines[0]).toMatchObject({
      id: asStmtId('s2'),
      callee: 'box',
      outputs: ['part0'],
      hasAssignment: true,
      hasComputedArgs: false,
      line: 2,
    })
    // refs：size 是参数，位置实参 var-ref → refs 含 size
    expect(meta.lines[0].refs).toEqual(['size'])
  })

  it('import 行 → imports 表（namespace：localName/packageName）', () => {
    const meta = extractMetadata("import * as mech from 'gear-lib-demo'\nlet p = cad.box(1, 2, 3)")
    expect(meta.imports).toHaveLength(1)
    expect(meta.imports[0]).toMatchObject({
      kind: 'namespace',
      localName: 'mech',
      specifier: 'gear-lib-demo',
      packageName: 'gear-lib-demo',
    })
  })

  it('function 行 → functions 表（名字/形参/原文）', () => {
    const code = [
      'function makeDouble(x) {',
      '  return cad.scale(x, 2)',
      '}',
      'let part0 = cad.box(1, 1, 1, { centered: true })',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.functions).toHaveLength(1)
    expect(meta.functions[0]).toMatchObject({ name: 'makeDouble', params: ['x'], lineNo: 1 })
    expect(meta.functions[0].body).toContain('return cad.scale(x, 2)')
    expect(meta.lines).toHaveLength(1)
  })

  it('循环块 → blocks 只读节点（不分析内部语义，R8）', () => {
    const code = [
      'let part0 = cad.box(1, 1, 1, { centered: true })',
      'for (let i = 0; i < 3; i++) {',
      '  let part1 = cad.sphere({ radius: i + 1 })',
      '}',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines).toHaveLength(1)
    expect(meta.blocks).toHaveLength(1)
    expect(meta.blocks[0]).toMatchObject({ kind: 'loop', astKind: 'ForStatement', lineNo: 2 })
    expect(meta.blocks[0].source).toContain('for (let i = 0; i < 3; i++)')
  })

  it('keep/keepHidden 指令 → keep 表（行号 → 条目；语句级 keepHidden 兜底）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(20, 20, 20, { centered: true, at: [10, 0, 0] })',
      'let part2 = cad.union(part0, part1, { keep: [part0], keepHidden: true })',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.keep.has(3)).toBe(true)
    const entries = meta.keep.get(3)!
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({ target: 'part0', hidden: true })
  })

  it('keep 无语句级默认 → hidden=false', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.union(part0, { keep: [part0] })',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.keep.get(2)?.[0]).toEqual({ target: 'part0', hidden: false })
  })

  it('容器代码：行号 = 原文行号（容器不封装）', () => {
    const code = [
      'export default async (cad) => {',
      '  let part0 = cad.box(20, 20, 20, { centered: true })',
      '  return { shape: part0, name: \'demo\' }',
      '}',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines).toHaveLength(1)
    expect(meta.lines[0].line).toBe(2)
    expect(meta.meta).toEqual({ name: 'demo' })
    expect(meta.terminalShapes?.[0]).toEqual({ id: 'part0', meta: { name: 'demo' } })
  })

  it('行号与现状 analyzeCode 一致（扁平封装偏移扣减）', () => {
    const code = [
      'const size = 20',
      '',
      'let part0 = cad.box(size, size, size, { centered: true })',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines[0].line).toBe(3)
    expect(analyzeCode(code)[0].line).toBe(3)
  })
})

describe('extractMetadata: HostArg 引用形态与 hasComputedArgs', () => {
  it('param-ref in object（radius:radius → param-ref）', () => {
    const code = [
      'const radius = 10',
      'let part1 = cad.sphere({ radius: radius, center: [30, 0, 0] })',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines[0].positional[0]).toEqual({
      radius: { kind: 'param-ref', name: 'radius' },
      center: [30, 0, 0],
    })
    expect(meta.lines[0].hasComputedArgs).toBe(false)
  })

  it('折叠表达式引用参数 → computed=true（F1-E1）', () => {
    const code = [
      'const base = 20',
      'let part0 = cad.box(base + 20, base + 20, base + 20, { centered: true })',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines[0].positional[0]).toBe(40)
    expect(meta.lines[0].hasComputedArgs).toBe(true)
  })

  it('纯字面量折叠不标 computed；负字面量是字面量', () => {
    const code = 'let part0 = cad.box(20 + 4 * 3, 20 + 4 * 3, 20 + 4 * 3, { centered: true })'
    const meta = extractMetadata(code)
    expect(meta.lines[0].positional[0]).toBe(32)
    expect(meta.lines[0].hasComputedArgs).toBe(false)

    const neg = 'let part1 = cad.fai_drill(part0, { diameter: 5, position: [0, 10, -10] })'
    const meta2 = extractMetadata('let part0 = cad.box(20, 20, 20, { centered: true })\n' + neg)
    expect(meta2.lines[1].args.position).toEqual([0, 10, -10])
    expect(meta2.lines[1].hasComputedArgs).toBe(false)
  })

  it('引用语句变量的表达式 → expr-ref（文本 + refs）且 computed=true', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0 + 1, part0 + 1, part0 + 1, { centered: true })',
    ].join('\n')
    const meta = extractMetadata(code)
    const first = meta.lines[1].positional[0] as { kind: string; text: string; refs: string[]; params: string[] }
    expect(first.kind).toBe('expr-ref')
    expect(first.text).toBe('part0 + 1')
    expect(first.refs).toEqual(['part0'])
    expect(meta.lines[1].hasComputedArgs).toBe(true)
  })

  it('成员方法调用：receiver/refs；解构：outputKeys', () => {
    const code = [
      "let asm0 = cad.assembly({ name: 'A' })",
      'asm0.do_assemble()',
      'let part0 = cad.box(10, 10, 10)',
      'const { front: part1, back: part2 } = cad.fai_split(part0)',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines[1]).toMatchObject({
      callee: 'do_assemble',
      receiver: 'asm0',
      outputs: [],
      hasAssignment: false,
      refs: ['asm0'],
    })
    expect(meta.lines[3]).toMatchObject({
      outputs: ['part1', 'part2'],
      outputKeys: ['front', 'back'],
    })
  })

  it('命名空间 import 调用：namespace + packageName', () => {
    const code = [
      "import * as mech from 'gear-lib-demo'",
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      "let part1 = mech.makeHeadstock(part0, { axis: 'x' })",
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines[1]).toMatchObject({
      namespace: 'mech',
      packageName: 'gear-lib-demo',
      outputs: ['part1'],
    })
  })
})

describe('extractMetadata: 语法自由回归（A-6/A-7/A-11）', () => {
  it('A-6 循环块：timeline 只读节点（单个 block 条目，不展开/不聚合）', () => {
    const code = [
      'let parts = cad.array({ n: 3, step: 10 })',
      'for (let i = 0; i < 3; i++) {',
      '  cad.box(10, 10, 10, { at: [i * 20, 0, 0] })',
      '}',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines).toHaveLength(1)
    expect(meta.blocks).toHaveLength(1)
    const b = meta.blocks[0]
    expect(b.kind).toBe('loop')
    expect(b.astKind).toBe('ForStatement')
    expect(b.lineNo).toBe(2)
    expect(b.source).toContain('for (let i = 0; i < 3; i++)')
    expect(meta.lines.every((l) => l.callee !== 'box' || l.line === 1)).toBe(true)
  })

  it('A-7 链式接收者：let w1 = w0.rect(...) → callee=rect receiver=w0', () => {
    const code = [
      'let w0 = cad.sketch({ closed: true })',
      'let w1 = w0.rect(100, 100)',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines).toHaveLength(2)
    expect(meta.lines[1]).toMatchObject({
      callee: 'rect',
      receiver: 'w0',
      outputs: ['w1'],
      hasAssignment: true,
    })
    expect(meta.lines[1].refs).toContain('w0')
  })

  it('A-11 派生常量/负字面量/自由语法：MetadataExtractor 零改动全通过', () => {
    const code = [
      'const OUTX = 24',
      'const INX = OUTX - 10',
      'let part0 = cad.box(INX, -10, 30, { centered: true })',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines).toHaveLength(1)
    expect(meta.params).toHaveLength(2)
    // OUTX 纯字面量参数
    expect(meta.params[0]).toMatchObject({ name: 'OUTX', value: 24, computed: false })
    // INX 引用参数 → computed 只读参数
    expect(meta.params[1]).toMatchObject({ name: 'INX', computed: true })
    // op 行参数求值：INX 已声明（computed 参数无值）→ 引用走 expr 语义或折叠失败场景不抛错
    const line = meta.lines[0]
    expect(line.callee).toBe('box')
    expect(line.line).toBe(3)
  })

  it('A-11 条件块：只读节点不分析内部语义', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'if (part0 != null) {',
      '  cad.box(5, 5, 5)',
      '}',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.lines).toHaveLength(1)
    expect(meta.blocks).toHaveLength(1)
    expect(meta.blocks[0].kind).toBe('condition')
  })
})

describe('extractMetadata: lines 与 analyzeCode 逐字相等（A-16 抽样）', () => {
  it('抽样语句行：除 id 外逐字段相等', () => {
    const codes = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      [
        'const size = 20',
        'let part0 = cad.box(size, size, size, { centered: true })',
      ].join('\n'),
      [
        'let part0 = cad.box(20, 20, 20, { centered: true })',
        'let part1 = cad.translate(part0, { offset: [5, 0, 0] })',
      ].join('\n'),
      [
        'let part0 = cad.box(20, 20, 20, { centered: true })',
        'let part1 = cad.union(part0, { keep: [part0], keepHidden: true })',
      ].join('\n'),
    ]
    for (const code of codes) {
      const oldLines = analyzeCode(code)
      const newLines = extractMetadata(code).lines
      expect(oldLines.length).toBe(newLines.length)
      for (let i = 0; i < oldLines.length; i++) {
        const o = oldLines[i]
        const n = newLines[i]
        const { id: _oId, ...oRest } = o
        const { id: _nId, ...nRest } = n
        expect(nRest).toEqual(oRest)
        // id = 's' + lineNo
        expect(String(n.id)).toBe(`s${n.line}`)
      }
    }
  })
})
