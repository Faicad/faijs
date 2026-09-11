/**
 * live-shapes — 无 IR 存活判定测试（P3）
 *
 * 覆盖：C0/C3/C5 消费判定、keep 驱动、hidden 最后一次保留胜出、块词法级扫描、
 * 无生产者 → 直接终端。与 computeLiveShapes 行为对齐（A-14 对拍见
 * packages/tests/faijs/no-ir/parity/a14-live-shapes.test.ts）。
 */

import { describe, it, expect } from 'vitest'
import { extractMetadata } from '../lang/metadata-extractor'
import { computeLiveShapes, keepViewFromMetadata, type LiveShapesInput, type KeepRegistration } from './live-shapes'
import { asPartName, type PartName } from '../identity'
import type { StatementSummary } from '../lang/statement-summary'

function liveShapeNames(
  code: string,
  fnKeep?: Map<number, KeepRegistration>,
  inplaceWrites?: Map<number, string>,
): string[] {
  const meta = extractMetadata(code)
  const shapeVarNames = new Set<PartName>()
  for (const l of meta.lines) for (const o of l.outputs) shapeVarNames.add(o)
  // 手工注入 shape 变量的场景也纳入候选（与运行时 ctx 键一致）
  const input: LiveShapesInput = {
    lines: meta.lines,
    blocks: meta.blocks,
    keep: {
      lineEntries: (lineNo) => meta.keep.get(lineNo),
      functionBody: (lineNo) => fnKeep?.get(lineNo),
    },
    shapeVarNames,
    ...(inplaceWrites ? { inplaceWrites } : {}),
  }
  const terminals = computeLiveShapes(input)
  return terminals.map((t) => String(t.id)).sort()
}

/** 行内 keep 辅助：给定行号的 keep 条目（直接改写源码中的 keep 指令即可，无需 helper）。 */

describe('computeLiveShapes: 消费判定', () => {
  it('boolean: box + sphere + subtract → 仅 subtract 终端', () => {
    const names = liveShapeNames([
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.sphere({ radius: 8, center: [5, 0, 0] })',
      'let part2 = cad.subtract(part0, part1)',
    ].join('\n'))
    expect(names).toEqual(['part2'])
  })

  it('链式重赋值 → 仅 1 终端', () => {
    const names = liveShapeNames([
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'part0 = cad.translate(part0, { offset: [5, 0, 0] })',
    ].join('\n'))
    expect(names).toEqual(['part0'])
  })

  it('被 keep 声明的输入不被消费（行内 keep → C0）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.union(part0, { keep: [part0] })',
    ].join('\n')
    expect(liveShapeNames(code)).toEqual(['part0', 'part1'])
  })

  it('keepHidden 声明保留但隐藏（hidden=true）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.union(part0, { keep: [part0], keepHidden: true })',
    ].join('\n')
    const meta = extractMetadata(code)
    const shapeVarNames = new Set<PartName>()
    for (const l of meta.lines) for (const o of l.outputs) shapeVarNames.add(o)
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepViewFromMetadata(meta),
      shapeVarNames,
    })
    const part0 = terminals.find((t) => String(t.id) === 'part0')
    expect(part0?.hidden).toBe(true)
  })

  it('C3：赋值但输出非几何（测量/查询）→ 不消费输入', () => {
    // 模拟第三方测量函数：输出是数值（非 shape）——C3 短路
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
    ].join('\n')
    const meta = extractMetadata(code)
    const measureLine: StatementSummary = {
      ...meta.lines[0],
      id: 's2' as never,
      callee: 'measureVolume',
      positional: [{ kind: 'var-ref', name: 'part0' }],
      args: {},
      outputs: [] as never, // 手写构造：非 shape 输出走 C3（outputs 为空且非几何）
      hasAssignment: true,
      hasComputedArgs: false,
      line: 2,
    }
    // shapeVarNames 只有 part0；measureLine outputs=[] → C3 不成立（outputs.length===0）。
    // 这里覆盖「输出为数值名」场景：
    const numericOut = { ...measureLine, outputs: ['measured'] as never }
    const terminals = computeLiveShapes({
      lines: [meta.lines[0], numericOut as StatementSummary],
      blocks: [],
      keep: keepViewFromMetadata(meta),
      shapeVarNames: new Set([asPartName('part0')]),
    })
    expect(terminals.map((t) => String(t.id))).toEqual(['part0'])
  })

  it('函数体 keep 登记（C1）→ 输入不被消费', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.group(part0, { members: [part0] })',
    ].join('\n')
    const fnKeep = new Map<number, KeepRegistration>()
    fnKeep.set(2, { kept: new Set([asPartName('part0')]), hidden: new Map() })
    expect(liveShapeNames(code, fnKeep)).toEqual(['part0', 'part1'])
  })

  it('hidden：最后一次保留声明胜出（后行 keep 覆盖 hidden=false）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.union(part0, { keep: [part0], keepHidden: true })',
      'let part2 = cad.scale(part1, 2)',
      'let part3 = cad.union(part2, { keep: [part2], keepHidden: false })',
    ].join('\n')
    const meta = extractMetadata(code)
    const shapeVarNames = new Set<PartName>()
    for (const l of meta.lines) for (const o of l.outputs) shapeVarNames.add(o)
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepViewFromMetadata(meta),
      shapeVarNames,
    })
    // part0: 无后行声明 → hidden 保持 true；part2: 后行 keepHidden:false → 可见
    const part0 = terminals.find((t) => String(t.id) === 'part0')
    const part2 = terminals.find((t) => String(t.id) === 'part2')
    expect(part0?.hidden).toBe(true)
    expect(part2?.hidden).toBeUndefined()
  })

  it('无生产者（跨文件引用/手工注入）→ 直接终端', () => {
    const meta = extractMetadata('let part1 = cad.box(10, 10, 10, { centered: true })')
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: [],
      keep: keepViewFromMetadata(meta),
      shapeVarNames: new Set([asPartName('external_part') as PartName, asPartName('part1')]),
    })
    expect(terminals.map((t) => String(t.id)).sort()).toEqual(['external_part', 'part1'])
  })
})

describe('P25 §3.7 规则 1：无赋值裸调用默认不消费（C4）', () => {
  it('C4：只读裸调用（projectView）不消费输入 → 输入仍终端', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'cad.projectView(part0, "front")',
    ].join('\n')
    expect(liveShapeNames(code)).toEqual(['part0'])
  })

  it('C4：修改类裸调用（fai_drill）本身不消费 → 输入仍终端（写回由 inplaceWrites 登记）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'cad.fai_drill(part0, { diameter: 3 })',
    ].join('\n')
    expect(liveShapeNames(code)).toEqual(['part0'])
  })

  it('C4：多行裸调用都不消费（自赋值与只读一视同仁）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'cad.projectView(part0, "front")',
      'cad.faceNormal(part0, 0)',
    ].join('\n')
    expect(liveShapeNames(code)).toEqual(['part0'])
  })

  it('C4 不破坏 C5：赋值语句（const/重赋值）仍按原规则消费', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.subtract(part0, { keep: [] })',
    ].join('\n')
    // part0 被 subtract 赋值行消费 → 仅 part1 终端
    expect(liveShapeNames(code)).toEqual(['part1'])
  })

  it('inplaceWrites：修改类裸调用把 producer 锚到该行——写回前的旧消费不误伤新值', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })', // 行1 producer
      'const p1 = cad.subtract(part0, { keep: [] })',        // 行2 消费旧 part0
      'cad.fai_drill(part0, { diameter: 3 })',               // 行3 裸调用写回
    ].join('\n')
    // 无登记：part0 producer=行1 → 行2 消费 → part0 不终端
    expect(liveShapeNames(code)).toEqual(['p1'])
    // 有登记（DirectExecutor 执行期产生）：part0 producer=行3 → 行2 旧消费不误伤 → part0 终端
    expect(liveShapeNames(code, undefined, new Map([[3, 'part0']]))).toEqual(['p1', 'part0'])
  })

  it('inplaceWrites：登记行之后的真实消费仍取消终端资格', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })', // 行1
      'cad.fai_drill(part0, { diameter: 3 })',               // 行2 写回
      'const p1 = cad.scale(part0, 2)',                      // 行3 消费新值
    ].join('\n')
    expect(liveShapeNames(code, undefined, new Map([[2, 'part0']]))).toEqual(['p1'])
  })

  it('inplaceWrites：只读裸调用行即使有登记也不会被 producer 误用（行号无对应 line 则忽略）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })', // 行1
      'cad.projectView(part0, "front")',                     // 行2 只读
    ].join('\n')
    // 即使外部误传了不存在的行号登记，也不影响（找不到 line 时忽略）
    expect(liveShapeNames(code, undefined, new Map([[99, 'part0']]))).toEqual(['part0'])
  })
})
