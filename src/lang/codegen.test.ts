/**
 * codegen 单元测试 — statementToLine / scriptToCode
 *
 * 覆盖：
 * - 全部 op 的语句 → 文本生成（与 parser 的 switch 对齐）
 * - scriptToCode 的扁平代码格式（无 export/return 封装）
 * - 值格式化（vec3/字符串/GeomRef/ParamRef/数字）
 */

import { describe, it, expect } from 'vitest'
import { statementToLine, scriptToCode, fmtNum } from './codegen'
import { parseScript } from './parser'
import type { CadStatement, PartScript } from './types'

// ── 测试辅助：构造语句 ──

function makeStmt(partial: Partial<CadStatement>): CadStatement {
  return {
    id: 'st_part1_1',
    op: 'box',
    args: {},
    inputs: [],
    ...partial,
  }
}

function makeScript(statements: CadStatement[]): PartScript {
  return { params: [], statements }
}

// ── statementToLine ──

describe('codegen: statementToLine 基本体', () => {
  it('box：size 为 vec3 输出数组', () => {
    const stmt = makeStmt({ id: 'part0_v0', op: 'box', args: { size: [10, 10, 10] } })
    expect(statementToLine(stmt)).toBe('const part0_v0 = cad.box({ size:[10,10,10] })')
  })

  it('box：size 为数字输出标量', () => {
    const stmt = makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } })
    expect(statementToLine(stmt)).toBe('const part0_v0 = cad.box({ size:20 })')
  })

  it('sphere / cylinder / cone / wedge', () => {
    expect(statementToLine(makeStmt({ id: 'part0_v0', op: 'sphere', args: { radius: 5, segments: 32 } })))
      .toBe('const part0_v0 = cad.sphere({ radius:5, segments:32 })')
    expect(statementToLine(makeStmt({ id: 'part0_v0', op: 'cylinder', args: { radius: 2, height: 10, segments: 32 } })))
      .toBe('const part0_v0 = cad.cylinder({ radius:2, height:10, segments:32 })')
  })
})

describe('codegen: statementToLine 变换', () => {
  it('translate', () => {
    const stmt = makeStmt({ id: 'part0_v1', op: 'translate', args: { offset: [1, 2, 3] }, inputs: ['part0_v0'] })
    expect(statementToLine(stmt)).toBe('const part0_v1 = cad.translate(part0_v0, { offset:[1,2,3] })')
  })

  it('rotate：含 pivot', () => {
    const stmt = makeStmt({ id: 'part0_v1', op: 'rotate', args: { anglesDeg: [0, 0, 90], pivot: [0, 0, 0] }, inputs: ['part0_v0'] })
    expect(statementToLine(stmt)).toBe('const part0_v1 = cad.rotate(part0_v0, { anglesDeg:[0,0,90], pivot:[0,0,0] })')
  })
})

describe('codegen: statementToLine 钻孔', () => {
  it('drill：通孔省略 holeType/tolerance 默认值', () => {
    const stmt = makeStmt({
      id: 'part0_v1',
      op: 'drill',
      args: {
        diameter: 5,
        depth: 0,
        holeType: 'simple',
        tolerance: 0.3,
        position: [0, 0, 10],
        faceNormal: [0, 0, 1],
      },
      inputs: ['part0_v0'],
    })
    expect(statementToLine(stmt)).toBe('const part0_v1 = cad.drill(part0_v0, { diameter:5, depth:0, position:[0,0,10], faceNormal:[0,0,1] })')
  })
})

describe('codegen: statementToLine 布尔', () => {
  it('boolean：输出 cad.operation(inputs)', () => {
    const stmt = makeStmt({
      id: 'part0_v2',
      op: 'boolean',
      args: { operation: 'subtract', sourcePartNames: ['p1', 'p2'] },
      inputs: ['part0_v0', 'part0_v1'],
    })
    expect(statementToLine(stmt)).toBe('const part0_v2 = cad.subtract(part0_v0, part0_v1)')
  })
})

describe('codegen: statementToLine 雕刻', () => {
  it('engrave：文本雕刻', () => {
    const stmt = makeStmt({
      id: 'part0_v1',
      op: 'engrave',
      args: { text: 'Hello', depth: 2, textSize: 10 },
      inputs: ['part0_v0'],
    })
    expect(statementToLine(stmt)).toBe("const part0_v1 = cad.engrave(part0_v0, { text:'Hello', depth:2, textSize:10 })")
  })
})

// ── scriptToCode ──

describe('codegen: scriptToCode', () => {
  it('单条 box 语句', () => {
    const script = makeScript([
      makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
    ])
    const code = scriptToCode(script)
    expect(code).toBe('const part0_v0 = cad.box({ size:20 })')
  })

  it('多级依赖：连续下游语句引用前一条', () => {
    const script = makeScript([
      makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
      makeStmt({ id: 'part0_v1', op: 'translate', args: { offset: [0, 0, 5] }, inputs: ['part0_v0'] }),
      makeStmt({ id: 'part0_v2', op: 'drill', args: { diameter: 5, depth: 0 }, inputs: ['part0_v1'] }),
    ])
    const code = scriptToCode(script)
    expect(code).toBe(
      'const part0_v0 = cad.box({ size:20 })\n' +
      'const part0_v1 = cad.translate(part0_v0, { offset:[0,0,5] })\n' +
      'const part0_v2 = cad.drill(part0_v1, { diameter:5, depth:0 })',
    )
  })

  it('空脚本：输出空字符串', () => {
    expect(scriptToCode(makeScript([]))).toBe('')
  })

  it('boolean op 输出 cad.union(inputs)', () => {
    const script = makeScript([
      makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
      makeStmt({ id: 'part0_v1', op: 'sphere', args: { radius: 10 } }),
      makeStmt({ id: 'part0_v2', op: 'boolean', args: { operation: 'union', sourcePartNames: ['s0', 's1'] }, inputs: ['part0_v0', 'part0_v1'] }),
    ])
    const code = scriptToCode(script)
    expect(code).toContain('cad.union(part0_v0, part0_v1)')
  })
})

// ── 多 mesh：split 解构 ──

describe('codegen: split 解构输出', () => {
  it('多输出 split 输出 const { front: part1_v0, back: part2_v0 } = cad.split(...)', () => {
    const script: PartScript = {
      params: [],
      statements: [
        makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
        makeStmt({ id: 'part0_v1', op: 'translate', args: { offset: [0, 0, 5] }, inputs: ['part0_v0'] }),
        makeStmt({
          id: 'part1_v0',
          op: 'split',
          args: { cutMode: 'plane', normal: [0, 0, 1], offset: 0, inPlaneAngleDeg: 0, side: 'front' },
          inputs: ['part0_v1'],
          outputs: ['part1_v0', 'part2_v0'],
        }),
      ],
    }
    const code = scriptToCode(script)
    expect(code).toContain('const { front: part1_v0, back: part2_v0 } = cad.split(part0_v1)')
  })
})

// ── 回归测试：外部 st_ id 含冒号时必须报错 ──

describe('codegen: 外部 st_ id 含冒号时报错', () => {
  it('split 引用无法解析的外部 id 时抛错', () => {
    const script: PartScript = {
      params: [],
      statements: [
        makeStmt({
          id: 'st_front_1',
          op: 'split',
          inputs: ['st_prim_panel_1:o1_1'],
          args: { normal: [0, 0, 1], offset: 0, inPlaneAngleDeg: 0, side: 'front', bbCenter: [0, 0, 0], bboxSize: [20, 20, 20] },
        }),
      ],
    }
    expect(() => scriptToCode(script)).toThrow(/unresolved input reference/)
  })
})

// ── 值格式化 ──

describe('codegen: 值格式化', () => {
  it('GeomRef → cad.faceCenter(of)', () => {
    const stmt = makeStmt({
      id: 'part0_v1',
      op: 'drill',
      args: {
        position: { $geom: { of: 'part0_v0', feature: 'faceCenter' } },
        faceNormal: { $geom: { of: 'part0_v0', feature: 'faceNormal' } },
      },
      inputs: ['part0_v0'],
    })
    const code = statementToLine(stmt)
    expect(code).toContain('position:cad.faceCenter(part0_v0)')
    expect(code).toContain('faceNormal:cad.faceNormal(part0_v0)')
  })

  it('ParamRef → 裸标识符（无 $ 前缀）', () => {
    const stmt = makeStmt({ id: 'part0_v0', op: 'box', args: { size: { $param: 'boxSize' } } })
    expect(statementToLine(stmt)).toBe('const part0_v0 = cad.box({ size:boxSize })')
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
    const script: PartScript = {
      params: [],
      statements: [makeStmt({ id: 'part0_v0', op: 'sphere', args: { radius: 5, segments: 32, center: [3, 4, 0] } })],
    }
    const code = scriptToCode(script)
    expect(code).toContain('center:[3,4,0]')
    const { script: parsed } = parseScript(code)
    expect(parsed.statements[0].args.center).toEqual([3, 4, 0])
  })
})

// ── GeomRef with faceOrdinal round-trip ──

describe('codegen: GeomRef with faceOrdinal round-trip', () => {
  it('GeomRef with faceOrdinal round-trip: codegen → parse → same args', () => {
    const script = makeScript([
      { id: 'part1_v0', op: 'box', args: { size: [10, 10, 10] }, inputs: [] },
      {
        id: 'part1_v1',
        op: 'engrave',
        args: {
          text: 'test',
          depth: 2,
          faceCenter: { $geom: { of: 'part1_v0', feature: 'faceCenter', faceOrdinal: 4, anchor: { point: [5, 5, 10] } } },
          faceNormal: { $geom: { of: 'part1_v0', feature: 'faceNormal', faceOrdinal: 4, anchor: { point: [5, 5, 10] } } },
        },
        inputs: ['part1_v0'],
      },
    ])
    const fullCode = scriptToCode(script)
    const parsed = parseScript(fullCode)
    const parsedStmt = parsed.script.statements[1]
    expect(parsedStmt.args.faceCenter).toEqual({
      $geom: { of: 'part1_v0', feature: 'faceCenter', faceOrdinal: 4, anchor: { point: [5, 5, 10] } },
    })
  })
})

// ── transform 语句 codegen 验证 ──

describe('codegen: transform 语句', () => {
  it('box + translate + rotate + scale', () => {
    const script = makeScript([
      makeStmt({ id: 's0', op: 'box', args: { size: 20 } }),
      makeStmt({ id: 's1', op: 'translate', args: { offset: [10, 0, 0] }, inputs: ['s0'] }),
      makeStmt({ id: 's2', op: 'rotate', args: { anglesDeg: [0, 0, 90] }, inputs: ['s1'] }),
      makeStmt({ id: 's3', op: 'scale', args: { factor: 2 }, inputs: ['s2'] }),
    ])
    const code = scriptToCode(script)
    expect(code).toContain('cad.translate(part0_v0, { offset:[10,0,0] })')
    expect(code).toContain('cad.rotate(part0_v1, { anglesDeg:[0,0,90] })')
    expect(code).toContain('cad.scale(part0_v2, { factor:2 })')
  })
})
