/**
 * statement-summary — StatementSummary 字段契约测试
 *
 * 断言 `extractMetadata(code).lines` 的输出（= 原 `analyzeCode` 的实现）。
 *
 * 契约：
 * - 产出 StatementSummary（id/callee/inputs/outputs/outputKeys/refs/receiver）
 * - line 为源码行号（1-based）
 */

import { describe, it, expect } from 'vitest'
import { extractMetadata } from '../../src/lang/metadata-extractor'
import { isHostVarRef } from '../../src/lang/host-arg'

/**
 * `analyzeCode` 已迁至 `@faicad/scene-kernel/feature-tree`（2026-10-17，A4）。
 * 它原本只有一行 `extractMetadata(code).lines`，此处 helper 与旧实现逐字等价 ——
 * 本文件钉的是 **StatementSummary 字段契约**，与函数住在哪个包无关。
 */
const analyzeCode = (code: string) => extractMetadata(code).lines

const BOX_DRILL_SPLIT = [
  'let part0 = cad.box(20, 20, 20, { centered: true })',
  'part0 = cad.fai_drill(part0, { diameter: 5 })',
  'const { front: part1, back: part2 } = cad.fai_split(part0, { normal: [0,0,1], offset: 0 })',
].join('\n')

describe('analyzeCode: 基本摘要', () => {
  it('box/drill/split 序列：id/callee/inputs/outputs/outputKeys 正确', () => {
    const summaries = analyzeCode(BOX_DRILL_SPLIT)

    expect(summaries).toHaveLength(3)

    // box
    expect(summaries[0].callee).toBe('box')
    expect(summaries[0].outputs).toEqual(['part0'])
    expect(summaries[0].hasAssignment).toBe(true)

    // drill (bare reassignment)
    expect(summaries[1].callee).toBe('fai_drill')
    const drillInputs = summaries[1].positional.filter(isHostVarRef).map(p => p.name)
    expect(drillInputs).toEqual(['part0'])
    expect(summaries[1].outputs).toEqual(['part0'])
    expect(summaries[1].hasAssignment).toBe(true)

    // split (destructuring)
    expect(summaries[2].callee).toBe('fai_split')
    const splitInputs = summaries[2].positional.filter(isHostVarRef).map(p => p.name)
    expect(splitInputs).toEqual(['part0'])
    expect(summaries[2].outputs).toEqual(['part1', 'part2'])
    expect(summaries[2].outputKeys).toEqual(['front', 'back'])
    expect(summaries[2].hasAssignment).toBe(true)
  })

  it('drill 复用名：outputs=[part0], hasAssignment=true（裸重赋值）', () => {
    const summaries = analyzeCode(BOX_DRILL_SPLIT)
    const drill = summaries[1]
    expect(drill.callee).toBe('fai_drill')
    const drillInputs = drill.positional.filter(isHostVarRef).map(p => p.name)
    expect(drillInputs).toEqual(['part0'])
    expect(drill.outputs).toEqual(['part0'])
    expect(drill.hasAssignment).toBe(true)
  })

  it('split 解构：双输出 + outputKeys=[front, back]', () => {
    const summaries = analyzeCode(BOX_DRILL_SPLIT)
    const split = summaries[2]
    expect(split.callee).toBe('fai_split')
    const splitInputs = split.positional.filter(isHostVarRef).map(p => p.name)
    expect(splitInputs).toEqual(['part0'])
    expect(split.outputs).toEqual(['part1', 'part2'])
    expect(split.outputKeys).toEqual(['front', 'back'])
  })

  it('成员方法调用：receiver/hasAssignment=false/outputs=[]', () => {
    const code = [
      'let asm0 = cad.assembly({ name: \'A\' })',
      'asm0.do_assemble()',
    ].join('\n')
    const summaries = analyzeCode(code)
    expect(summaries).toHaveLength(2)
    const asmCall = summaries[1]
    expect(asmCall.callee).toBe('do_assemble')
    expect(asmCall.receiver).toBe('asm0')
    expect(asmCall.hasAssignment).toBe(false)
    expect(asmCall.outputs).toEqual([])
  })
})

describe('analyzeCode: line 为源码行号', () => {
  it('扁平代码：每条语句的 line 与文本行一致（1-based）', () => {
    const summaries = analyzeCode(BOX_DRILL_SPLIT)
    expect(summaries[0].line).toBe(1)
    expect(summaries[1].line).toBe(2)
    expect(summaries[2].line).toBe(3)
  })

  it('参数行占用行号时语句行号顺延', () => {
    const code = [
      'const height = 10',
      '',
      'let part0 = cad.box(height, height, height, { centered: true })',
    ].join('\n')
    const summaries = analyzeCode(code)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].line).toBe(3)
  })
})

// ── codeToArgs 的用例随函数迁出（2026-10-17，A4）────────────────────────────
// `codeToArgs` 是编辑器的单行提取入口，已迁至 `@faicad/scene-kernel/feature-tree`；
// 它的形态断言（普通行 / 解构 / 成员调用 / 本机调用 / 参数引用）在宿主仓的
// `feature-tree/code-layer-golden.test.ts` 里有 golden 覆盖。本文件只保留
// StatementSummary 自身的契约断言。

describe('§7.1-B: analyzeCode summary.args 形态（T3-b / T4-a）', () => {
  it('summary.args 含 HostArg 引用形态', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'part0 = cad.chamfer(part0, { edgeLength: 3, faceCenter: cad.faceNormal(part0, [10, 10, 0], 4) })',
    ].join('\n')
    const summary = analyzeCode(code)[1]
    expect(summary.args.faceCenter).toEqual({
      kind: 'call-ref',
      callee: 'faceNormal',
      args: [
        { kind: 'var-ref', name: 'part0' },
        [10, 10, 0],
        4,
      ],
    })
  })
})
