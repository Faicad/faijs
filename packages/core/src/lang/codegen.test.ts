/**
 * codegen 单元测试 — statementIRToLine / scriptIRToCode (Phase 3)
 *
 * Phase 3 命名规则：
 * - 单入单出 → 复用输入名，`let` 重赋值
 * - 无输入/单输出 → 新名 `partN`，`let` 首次声明
 * - split → `const { front: partN, back: partM } = cad.fai_split(...)`
 * - group/assembly → `let partN = cad.group(...)`
 */

import { describe, it, expect } from 'vitest'
import { statementIRToLine, scriptIRToCode, fmtNum, formatCodeLine } from './codegen'
import { codeToArgs } from './code-to-args'
import { parseScript } from './parser'
import type { StatementIR, ScriptIR } from './types'
import { asStmtId, asPartName } from '../identity'

// ── 测试辅助：构造语句 ──

function makeStmt(
  partial: Omit<Partial<StatementIR>, 'id' | 'outputs'> & { id?: string; inputs?: string[]; outputs?: string[] },
): StatementIR {
  const { id, inputs, positional, outputs, ...rest } = partial
  return {
    id: asStmtId(id ?? 's1'),
    callee: 'box',
    args: {},
    positional: positional ?? (inputs ?? []).map((s) => ({ $ref: asPartName(String(s)) })),
    outputs: (outputs ?? [id ?? 'part0']).map(asPartName),
    ...rest,
  }
}

function makeScript(statements: StatementIR[]): ScriptIR {
  return { params: [], statements }
}

// ── statementIRToLine ──

describe('codegen: statementIRToLine 基本体 (Phase 3)', () => {
  it('box：size 为 vec3 输出数组', () => {
    const stmt = makeStmt({ id: 's1', callee: 'box', positional: [10, 10, 10, { centered:true }], outputs: ['part0'] })
    expect(statementIRToLine(stmt)).toBe('let part0 = cad.box(10, 10, 10, { centered:true })')
  })

  it('box：size 为数字输出标量', () => {
    const stmt = makeStmt({ id: 's1', callee: 'box', positional: [20, 20, 20, { centered:true }], outputs: ['part0'] })
    expect(statementIRToLine(stmt)).toBe('let part0 = cad.box(20, 20, 20, { centered:true })')
  })

  it('sphere / cylinder / cone / wedge', () => {
    expect(statementIRToLine(makeStmt({ id: 's1', callee: 'sphere', args: { radius: 5, segments: 32 }, outputs: ['part0'] })))
      .toBe('let part0 = cad.sphere({ radius:5, segments:32 })')
    expect(statementIRToLine(makeStmt({ id: 's1', callee: 'cylinder', args: { radius: 2, height: 10, segments: 32 }, outputs: ['part0'] })))
      .toBe('let part0 = cad.cylinder({ radius:2, height:10, segments:32 })')
  })
})

describe('codegen: statementIRToLine 变换 (Phase 3: 复用输入名)', () => {
  it('translate — 复用输入名', () => {
    const stmt = makeStmt({ id: 's2', callee: 'translate', args: { offset: [1, 2, 3] }, inputs: ['part0'], outputs: ['part0'] })
    expect(statementIRToLine(stmt)).toBe('let part0 = cad.translate(part0, { offset:[1,2,3] })')
  })

  it('rotate_euler：含 pivot — 复用输入名', () => {
    const stmt = makeStmt({ id: 's2', callee: 'rotate_euler', args: { anglesDeg: [0, 0, 90], pivot: [0, 0, 0] }, inputs: ['part0'], outputs: ['part0'] })
    expect(statementIRToLine(stmt)).toBe('let part0 = cad.rotate_euler(part0, { anglesDeg:[0,0,90], pivot:[0,0,0] })')
  })
})

describe('codegen: statementIRToLine 钻孔 (Phase 3: 复用输入名)', () => {
  it('drill：IR 里有什么打印什么（A12 消灭默认值省略）', () => {
    const stmt = makeStmt({
      id: 's2',
      callee: 'fai_drill',
      args: {
        diameter: 5,
        depth: 0,
        holeType: 'simple',
        tolerance: 0.3,
        position: [0, 0, 10],
        faceNormal: [0, 0, 1],
      },
      inputs: ['part0'],
      outputs: ['part0'],
    })
    expect(statementIRToLine(stmt)).toBe("let part0 = cad.fai_drill(part0, { diameter:5, depth:0, holeType:'simple', tolerance:0.3, position:[0,0,10], faceNormal:[0,0,1] })")
  })
})

describe('codegen: statementIRToLine 布尔 (Phase 3: 新名)', () => {
  it('boolean 归一取消：callee 直写 subtract', () => {
    const stmt = makeStmt({
      id: 's3',
      callee: 'subtract',
      args: {},
      inputs: ['part0', 'part1'],
      outputs: ['part2'],
    })
    expect(statementIRToLine(stmt)).toBe('let part2 = cad.subtract(part0, part1)')
  })
})

describe('codegen: statementIRToLine 雕刻 (Phase 3: 复用输入名)', () => {
  it('engrave：文本雕刻', () => {
    const stmt = makeStmt({
      id: 's2',
      callee: 'engrave',
      args: { text: 'Hello', depth: 2, textSize: 10 },
      inputs: ['part0'],
      outputs: ['part0'],
    })
    expect(statementIRToLine(stmt)).toBe("let part0 = cad.engrave(part0, { text:'Hello', depth:2, textSize:10 })")
  })
})

// ── scriptIRToCode ──

describe('codegen: scriptIRToCode (Phase 3)', () => {
  it('单条 box 语句', () => {
    const script = makeScript([
      makeStmt({ id: 's1', callee: 'box', positional: [20, 20, 20, { centered:true }], outputs: ['part0'] }),
    ])
    const code = scriptIRToCode(script)
    expect(code).toBe('let part0 = cad.box(20, 20, 20, { centered:true })')
  })

  it('多级依赖：连续下游复用输入名', () => {
    const script = makeScript([
      makeStmt({ id: 's1', callee: 'box', positional: [20, 20, 20, { centered:true }], outputs: ['part0'] }),
      makeStmt({ id: 's2', callee: 'translate', args: { offset: [0, 0, 5] }, inputs: ['part0'], outputs: ['part0'] }),
      makeStmt({ id: 's3', callee: 'fai_drill', args: { diameter: 5, depth: 0 }, inputs: ['part0'], outputs: ['part0'] }),
    ])
    const code = scriptIRToCode(script)
    expect(code).toBe(
      'let part0 = cad.box(20, 20, 20, { centered:true })\n' +
      'part0 = cad.translate(part0, { offset:[0,0,5] })\n' +
      'part0 = cad.fai_drill(part0, { diameter:5, depth:0 })',
    )
  })

  it('空脚本：输出空字符串', () => {
    expect(scriptIRToCode(makeScript([]))).toBe('')
  })

  it('boolean op 输出 cad.union(inputs)（归一取消，callee 直写）', () => {
    const script = makeScript([
      makeStmt({ id: 's1', callee: 'box', positional: [20, 20, 20, { centered:true }], outputs: ['part0'] }),
      makeStmt({ id: 's2', callee: 'sphere', args: { radius: 10 }, outputs: ['part1'] }),
      makeStmt({ id: 's3', callee: 'union', args: {}, inputs: ['part0', 'part1'], outputs: ['part2'] }),
    ])
    const code = scriptIRToCode(script)
    expect(code).toContain('cad.union(part0, part1)')
  })
})

// ── 多 mesh：split 解构 ──

describe('codegen: split 解构输出 (Phase 3)', () => {
  it('多输出 split 输出 const { front: part1, back: part2 } = cad.fai_split(...)', () => {
    const script: ScriptIR = {
      params: [],
      statements: [
        makeStmt({ id: 's1', callee: 'box', positional: [20, 20, 20, { centered:true }], outputs: ['part0'] }),
        makeStmt({ id: 's2', callee: 'translate', args: { offset: [0, 0, 5] }, inputs: ['part0'], outputs: ['part0'] }),
        makeStmt({
          id: 's3',
          callee: 'fai_split',
          args: { cutMode: 'plane', normal: [0, 0, 1], offset: 0, inPlaneAngleDeg: 0, side: 'front' },
          inputs: ['part0'],
          outputs: ['part1', 'part2'],
          outputKeys: ['front', 'back'],
        }),
      ],
    }
    const code = scriptIRToCode(script)
    // 通用打印机：IR 里有什么打印什么（split 的 args 原样输出，不再省略）
    expect(code).toContain('const { front: part1, back: part2 } = cad.fai_split(part0, { cutMode:\'plane\', normal:[0,0,1], offset:0, inPlaneAngleDeg:0, side:\'front\' })')
  })
})

// ── 回归测试：外部 st_ id 含冒号时必须报错 ──

describe('codegen: 外部 st_ id 含冒号时报错', () => {
  it('split 引用无法解析的外部 id 时抛错', () => {
    const script: ScriptIR = {
      params: [],
      statements: [
        makeStmt({
          id: 'st_front_1',
          callee: 'fai_split',
          inputs: ['st_prim_panel_1:o1_1'],
          args: { normal: [0, 0, 1], offset: 0, inPlaneAngleDeg: 0, side: 'front', bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] },
          outputs: ['part0', 'part1'],
        }),
      ],
    }
    expect(() => scriptIRToCode(script)).toThrow(/unresolved input reference/)
  })
})

// ── 值格式化 ──

describe('codegen: 值格式化', () => {
  it('CallRefIR → cad.faceNormal(of)', () => {
    const stmt = makeStmt({
      id: 's2',
      callee: 'fai_drill',
      args: {
        position: { $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }] } },
        faceNormal: { $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }] } },
      },
      inputs: ['part0'],
      outputs: ['part0'],
    })
    const code = statementIRToLine(stmt)
    expect(code).toContain('position:cad.faceNormal(part0)')
    expect(code).toContain('faceNormal:cad.faceNormal(part0)')
  })

  it('ParamRefIR → 裸标识符（无 $ 前缀）', () => {
    const stmt = makeStmt({ id: 's1', callee: 'box', positional: [{ $param: 'boxSize' }, { $param: 'boxSize' }, { $param: 'boxSize' }, { centered:true }], outputs: ['part0'] })
    expect(statementIRToLine(stmt)).toBe('let part0 = cad.box(boxSize, boxSize, boxSize, { centered:true })')
  })

  it('fmtNum：整数直出、小数去尾零', () => {
    expect(fmtNum(20)).toBe('20')
    expect(fmtNum(0.1)).toBe('0.1')
    expect(fmtNum(0.30000000000000004)).toBe('0.3')
    expect(fmtNum(1.5)).toBe('1.5')
    expect(fmtNum(-0)).toBe('0')
  })
})

// ── center 参数往返：codegen → parser → 语义一致 ──

describe('codegen: center 参数往返 (codegen → parser)', () => {
  it('sphere 含 center 往返', () => {
    const script: ScriptIR = {
      params: [],
      statements: [makeStmt({ id: 's1', callee: 'sphere', args: { radius: 5, segments: 32, center: [3, 4, 0] }, outputs: ['part0'] })],
    }
    const code = scriptIRToCode(script)
    expect(code).toContain('center:[3,4,0]')
    const { script: parsed } = parseScript(code)
    expect(parsed.statements[0].args.center).toEqual([3, 4, 0])
  })
})

// ── CallRefIR with faceOrdinal round-trip ──

describe('codegen: CallRefIR with faceOrdinal round-trip', () => {
  it('CallRefIR with faceOrdinal round-trip: codegen → parse → same args', () => {
    const script = makeScript([
      makeStmt({ id: 's1', callee: 'box', positional: [10, 10, 10, { centered:true }], outputs: ['part0'] }),
      makeStmt({
        id: 's2',
        callee: 'engrave',
        args: {
          text: 'test',
          depth: 2,
          faceCenter: { $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }, [5, 5, 10], 4] } },
          faceNormal: { $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }, [5, 5, 10], 4] } },
        },
        inputs: ['part0'],
        outputs: ['part0'],
      }),
    ])
    const fullCode = scriptIRToCode(script)
    const parsed = parseScript(fullCode)
    const parsedStmt = parsed.script.statements[1]
    expect(parsedStmt.args.faceCenter).toEqual({
      $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }, [5, 5, 10], 4] },
    })
  })
})

// ── transform 语句 codegen 验证 ──

describe('codegen: transform 语句 (Phase 3: 复用输入名)', () => {
  it('box + translate + rotate_euler + scale3d', () => {
    const script = makeScript([
      makeStmt({ id: 's1', callee: 'box', positional: [20, 20, 20, { centered:true }], outputs: ['part0'] }),
      makeStmt({ id: 's2', callee: 'translate', args: { offset: [10, 0, 0] }, inputs: ['part0'], outputs: ['part0'] }),
      makeStmt({ id: 's3', callee: 'rotate_euler', args: { anglesDeg: [0, 0, 90] }, inputs: ['part0'], outputs: ['part0'] }),
      makeStmt({ id: 's4', callee: 'scale3d', args: { factor: 2 }, inputs: ['part0'], outputs: ['part0'] }),
    ])
    const code = scriptIRToCode(script)
    expect(code).toContain('cad.translate(part0, { offset:[10,0,0] })')
    expect(code).toContain('cad.rotate_euler(part0, { anglesDeg:[0,0,90] })')
    expect(code).toContain('cad.scale3d(part0, { factor:2 })')
  })
})

// ── 多行字符串参数：escapeStr 往返（SDF code / text 等） ──
// 回归：escapeStr 之前只转义 \\ 与 '，多行字符串参数嵌入 '…' 后产生非法 JS
// （3d_editor SDF 生成 → formatCodeLine → analyzeCode 抛 Unterminated string）。

describe('codegen: 多行字符串参数往返（escapeStr 控制符转义修复）', () => {
  const multiCode = [
    'return x > 0 ? 1.0 : 0.0;',
    "// comment with 'single' quote",
    'const s = "double" + "\\"backslash\\"";',
    '',
    '\tindented line after tab',
  ].join('\r\n')

  it('scriptIRToCode 输出单行合法 JS，parseScript 后字符串精确还原', () => {
    const stmt = makeStmt({
      id: 's1',
      callee: 'text',
      args: { text: multiCode, at: [0, 0, 0], opts: {} },
      outputs: ['part0'],
    })
    const code = scriptIRToCode(makeScript([stmt]))
    // 不允许裸换行/回车出现在生成的 JS 文本里
    expect(code).not.toMatch(/[\r\n]/)
    const parsed = parseScript(code)
    expect(parsed.script.statements).toHaveLength(1)
    expect(parsed.script.statements[0].args.text).toBe(multiCode)
  })

  it('formatCodeLine → codeToArgs（宿主路径）也保持多行字符串参数', async () => {
    const { formatCodeLine } = await import('./codegen')
    const { codeToArgs } = await import('./code-to-args')
    const line = formatCodeLine({
      callee: 'text',
      positional: [],
      outputs: ['part0'],
      args: { text: multiCode, at: [0, 0, 0], opts: {} },
    })
    expect(line).not.toMatch(/\r|\n/)
    const args = codeToArgs(line)
    expect(args.args.text).toBe(multiCode)
  })
})

// ── §7.1-C: formatCodeLine(HostArg) → codeToArgs 直接往返 ──

describe('§7.1-C: formatCodeLine(HostArg) → codeToArgs 直接往返', () => {
  it('T1-a: literal positional — [10, 20, 30] 往返', () => {
    const line = formatCodeLine({
      callee: 'box',
      positional: [10, 20, 30],
      outputs: ['part0'],
    })
    const result = codeToArgs(line)
    expect(result.positional).toEqual([10, 20, 30])
    expect(result.args).toEqual({})
  })

  it('T4-b: call-ref HostArg 往返 (formatCodeLine → full-script parse)', () => {
    const line = formatCodeLine({
      callee: 'chamfer',
      positional: [{ kind: 'var-ref', name: 'part0' }],
      outputs: ['part0'],
      outputDeclared: true,
      args: {
        edgeLength: 3,
        faceCenter: {
          kind: 'call-ref',
          callee: 'faceNormal',
          args: [
            { kind: 'var-ref', name: 'part0' },
            [10, 10, 0],
            4,
          ],
        },
      },
    })
    const fullCode = 'let part0 = cad.box(20, 20, 20, { centered:true })\n' + line
    const { script } = parseScript(fullCode)
    const stmt = script.statements[1]
    // Positional var-ref preserved
    expect(stmt.positional[0]).toEqual({ $ref: 'part0' })
    // args preserved
    expect(stmt.args.edgeLength).toBe(3)
    expect(stmt.args.faceCenter).toEqual({
      $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }, [10, 10, 0], 4] },
    })
  })

  it('T5-a: expr-ref HostArg 往返 (formatCodeLine → full-script parse)', () => {
    // codeToArgs statically folds expressions (let base = 0 → 0 + 20 = 20).
    // For expr-ref roundtrip, use full-script context where base is a real statement var.
    const line = formatCodeLine({
      callee: 'box',
      positional: [],
      outputs: ['part1'],
      args: {
        width: { kind: 'expr-ref', text: 'base + 20', refs: ['base'], params: [] },
        depth: 3,
        height: 10,
        at: [10, 0, 0],
      },
    })
    // expr-ref codegen 打印为 (text)
    expect(line).toContain('width:(base + 20)')
    // Full script context: base is a real shape variable (not a param),
    // so the expression can't be folded and stays as ExprIR
    const fullCode = 'let base = cad.box(10, 10, 10, { centered:true })\n' + line
    const { script } = parseScript(fullCode)
    const stmt = script.statements[1]
    expect(stmt.args.width).toEqual({
      $expr: { text: 'base + 20', refs: ['base'], params: [] },
    })
    expect(stmt.args.depth).toBe(3)
    expect(stmt.args.height).toBe(10)
    expect(stmt.args.at).toEqual([10, 0, 0])
  })

  it('T6-a: 混合形态往返 — positional [var-ref] + args 含 expr/call/literal (full-script parse)', () => {
    const line = formatCodeLine({
      callee: 'chamfer',
      positional: [
        { kind: 'var-ref', name: 'part0' },
        ],
      outputs: ['part0'],
      outputDeclared: true,
      args: {
        edgeLength: { kind: 'expr-ref', text: 'base_offset + 1', refs: ['base_offset'], params: [] },
        faceCenter: {
          kind: 'call-ref',
          callee: 'faceNormal',
          args: [{ kind: 'var-ref', name: 'part0' }, [10, 10, 0], 4],
        },
        distance: 2,
        keep: ['part0'],
      },
    })
    // Full script context for proper var-ref / expr-ref resolution
    const fullCode = [
      'let part0 = cad.box(20, 20, 20, { centered:true })',
      'let base_offset = cad.box(10, 10, 10, { centered:true })',
      line,
    ].join('\n')
    const { script } = parseScript(fullCode)
    const stmt = script.statements[2]
    expect(stmt.positional[0]).toEqual({ $ref: 'part0' })
    expect(stmt.args.edgeLength).toEqual({
      $expr: { text: 'base_offset + 1', refs: ['base_offset'], params: [] },
    })
    expect(stmt.args.faceCenter).toEqual({
      $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }, [10, 10, 0], 4] },
    })
    expect(stmt.args.distance).toBe(2)
    expect(stmt.args.keep).toEqual(['part0'])
  })
})

// ── §7.1-D: $param parse → codegen → parse 往返 (T3-a) ──

describe('§7.1-D: $param parse → codegen → parse 往返 (T3-a)', () => {
  it('T3-a: cad.box(boxSize, boxSize, boxSize, { centered:true }) 往返 — 两次 parse 的 IR deepEqual', () => {
    const code = [
      'const boxSize = 20',
      'let part0 = cad.box(boxSize, boxSize, boxSize, { centered:true })',
    ].join('\n')
    const { script: parsed1 } = parseScript(code)
    const ir1 = parsed1.statements[0].positional[0]
    expect(ir1).toEqual({ $ref: 'boxSize' })

    // codegen 打印
    const printed = scriptIRToCode(parsed1)
    expect(printed).toContain('boxSize, boxSize, boxSize')

    // 再解析
    const { script: parsed2 } = parseScript(printed)
    const ir2 = parsed2.statements[0].positional[0]
    expect(ir2).toEqual({ $ref: 'boxSize' })
    // 两次 parse 的 IR deepEqual
    expect(ir2).toEqual(ir1)
  })
})
