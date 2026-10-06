/**
 * live-shapes — 无 IR 存活判定测试（P3）
 *
 * 覆盖：R1/R3/R5 消费判定、keep 驱动、hidden 最后一次保留胜出、块词法级扫描、
 * 无生产者 → 直接终端。与 computeLiveShapes 行为对齐（A-14 对拍见
 * packages/tests/faijs/no-ir/parity/a14-live-shapes.test.ts）。
 */

import { describe, it, expect } from 'vitest'
import { extractMetadata } from '../../src/lang/metadata-extractor'
import { computeLiveShapes, keepViewFromMetadata, type LiveShapesInput, type KeepRegistration } from '../../src/cad-runtime/live-shapes'
import { asPartName, type PartName } from '../../src/identity'
import type { StatementSummary } from '../../src/lang/statement-summary'

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

  it('R1 机制锚点：subtract 输入被消费；boolean op 的 keepHidden 使其保留为隐藏终端', () => {
    // FCStd port「中间 feature var 泄漏为 terminal」（如 TS35 solids 1vsN）的根因锚点。
    // 两层事实必须同时成立，缺一就会误判根因：
    //   1）消费扫描本身正确——无 keep 时 `subtract(part0, part1)` 的 positional var-ref
    //      被 lineConsumes 识别为消费 → 仅 part2 终端（＝下面的第一个断言）。
    //   2）真运行时 `cad.subtract` 函数体调用 `keepHidden(...inputs)`（`api/boolean.ts`，
    //      R5 语义：布尔源保留但隐藏）→ 登记落到 subtract 调用行（行号键）→ R1 短路
    //      「不消费」→ part0/part1 作为 hidden terminal 存活（＝下面的第二个断言，也是
    //      runtime.test.ts「box+sphere+subtract → 3 终端」的成因）。
    // 结论：1vsN 不是 computeLiveShapes/lineConsumes 漏判（计划 B4 假设），是 op 内建 keep。
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.cylinder({ radius: 5, height: 20 })',
      'let part2 = cad.subtract(part0, part1)',
    ].join('\n')
    expect(liveShapeNames(code)).toEqual(['part2'])
    // 模拟 api/boolean.ts 的 keepHidden(part0, part1)：函数体 keep 登记到 subtract 调用行（行 3）
    const fnKeep = new Map<number, KeepRegistration>()
    fnKeep.set(3, {
      kept: new Set([asPartName('part0'), asPartName('part1')]),
      hidden: new Map([
        [asPartName('part0'), true],
        [asPartName('part1'), true],
      ]),
    })
    expect(liveShapeNames(code, fnKeep)).toEqual(['part0', 'part1', 'part2'])
  })

  it('链式重赋值 → 仅 1 终端', () => {
    const names = liveShapeNames([
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'part0 = cad.translate(part0, { offset: [5, 0, 0] })',
    ].join('\n'))
    expect(names).toEqual(['part0'])
  })

  it('被 keep 声明的输入不被消费（行内 keep → R1）', () => {
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

  it('R3：赋值但输出非几何（测量/查询）→ 不消费输入', () => {
    // 模拟第三方测量函数：输出是数值（非 shape）——R3 短路
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
      outputs: [] as never, // 手写构造：非 shape 输出走 R3（outputs 为空且非几何）
      hasAssignment: true,
      hasComputedArgs: false,
      line: 2,
    }
    // shapeVarNames 只有 part0；measureLine outputs=[] → R3 不成立（outputs.length===0）。
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

describe('P25 §3.7 规则 1：无赋值裸调用默认不消费（R2）', () => {
  it('R2：只读裸调用（projectView）不消费输入 → 输入仍终端', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'cad.projectView(part0, "front")',
    ].join('\n')
    expect(liveShapeNames(code)).toEqual(['part0'])
  })

  it('R2：修改类裸调用（fai_drill）本身不消费 → 输入仍终端（写回由 inplaceWrites 登记）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'cad.fai_drill(part0, { diameter: 3 })',
    ].join('\n')
    expect(liveShapeNames(code)).toEqual(['part0'])
  })

  it('R2：多行裸调用都不消费（自赋值与只读一视同仁）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'cad.projectView(part0, "front")',
      'cad.faceNormal(part0, 0)',
    ].join('\n')
    expect(liveShapeNames(code)).toEqual(['part0'])
  })

  it('R2 不破坏 R5：赋值语句（const/重赋值）仍按原规则消费', () => {
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

  // E-1 最小复现（D-1 泄漏，2026-10-06）：fcstd 语料 25 产品实测——
  // `let X = cad.import_brep(...)`（资产声明）随后被 mirror/pattern 的
  // positional 首参消费，X 却仍是终端（ Leakage 见 fcstd-port out/d2-anatomy.txt）。
  // 用例按泄漏形态逐 op 构造；哪条断言红，漏判就在哪一层。
  describe('E-1 repro: D-1 泄漏形态（import_brep/extrude + 修饰型 op 消费）', () => {
    it('mirror 消费 import_brep 声明 → 仅 mirroring 终端（Sliding_door 形态）', () => {
      const code = [
        'let part0 = cad.import_brep({ asset: "PartShape" })',
        'let mir = cad.mirror(part0, { normal: [0, 1, 0], at: [0, 150, 0] })',
      ].join('\n')
      expect(liveShapeNames(code)).toEqual(['mir'])
    })

    it('circularPattern 消费 import_brep 声明 → 仅 pattern 终端（45x45/Futaba 形态，泄漏最多样本族）', () => {
      const code = [
        'let part0 = cad.import_brep({ asset: "PartShape" })',
        'let pat = cad.circularPattern(part0, [1, 0, 0], 4, 360)',
      ].join('\n')
      expect(liveShapeNames(code)).toEqual(['pat'])
    })

    it('linearPattern 消费 import_brep 声明 → 仅 pattern 终端（arduino-mega 形态）', () => {
      const code = [
        'let part0 = cad.import_brep({ asset: "PartShape" })',
        'let pat = cad.linearPattern(part0, [1, 0, 0], 18, 2.54)',
      ].join('\n')
      expect(liveShapeNames(code)).toEqual(['pat'])
    })

    it('place 消费 import_brep 声明 → 仅 placed 终端（pin-header 形态）', () => {
      const code = [
        'let part0 = cad.import_brep({ asset: "PartShape" })',
        'let placed = cad.place(part0, { rotation: [0, 0, 0, 1], position: [1, 2, 3] })',
      ].join('\n')
      expect(liveShapeNames(code)).toEqual(['placed'])
    })

    it('mirror 消费 fillet/extrude 声明 → 仅 mirroring 终端（fillet 2 / extrude 4 样本形态）', () => {
      const code = [
        'let base = cad.box(20, 20, 20, { centered: true })',
        'let fil = cad.fillet(base, { edges: [cad.edgeRef(base, 0)], radius: 2 })',
        'let mir = cad.mirror(fil, { normal: [0, 1, 0], at: [0, 0, 0] })',
      ].join('\n')
      expect(liveShapeNames(code)).toEqual(['mir'])
    })

    it('compound 组装 + 修饰型消费并存 → 被消费变量不因 compound 成员身份而免判（pololu 形态）', () => {
      const code = [
        'let part0 = cad.import_brep({ asset: "PartShape" })',
        'let pat = cad.linearPattern(part0, [1, 0, 0], 8, 2.54)',
        'let other = cad.import_brep({ asset: "PartShape2" })',
        'let assembly = cad.compound({ members: [other, pat] })',
      ].join('\n')
      // part0 被 pattern 消费 → 不终端；compound members 组装不是消费，
      // other/pat 经 assembly 导出 → 终端 = other? 否——compound 成员不单列，
      // computeLiveShapes 的候选不含 compound 自身时 members 即终端。
      const names = liveShapeNames(code)
      expect(names).not.toContain('part0')
    })

    it('R5 锚点：mirror 首参 VarRef 是 positional 顶层引用（被消费的机制依据）', () => {
      // 直接断言 lineConsumes 的扫描行为——若此用例红而上面绿，
      // 说明漏判不在扫描层，而在 lines 提取/keep 表等上游。
      const meta = extractMetadata([
        'let part0 = cad.import_brep({ asset: "A" })',
        'let mir = cad.mirror(part0, { normal: [0, 1, 0], at: [0, 0, 0] })',
      ].join('\n'))
      const mir = meta.lines.find((l) => l.callee?.endsWith('mirror'))!
      expect(mir).toBeDefined()
      expect(mir.positional.some((a) => a.kind === 'var-ref' && (a as { name: string }).name === 'part0')).toBe(true)
    })
  })
})
