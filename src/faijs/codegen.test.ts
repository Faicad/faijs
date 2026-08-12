/**
 * codegen 单元测试 — statementToCode / scriptToCode
 *
 * 覆盖：
 * - 全部 op 的语句 → 文本生成（与 executeStatement 的 switch 对齐）
 * - scriptToCode 的合法 JS 子集格式（export default async (cad) => { ... }）
 * - 值格式化（vec3/字符串/GeomRef/ParamRef/数字）
 * - 统一 async（§6.1）：所有 op 加 await
 */

import { describe, it, expect } from 'vitest'
import { parse as acornParse } from 'acorn'
import { statementToCode, scriptToCode, sceneToCode, fmtNum } from './codegen'
import { parseScript } from './parser'
import type { CadStatement, PartScript } from './types'

// ── 测试辅助：构造语句 ──

function makeStmt(partial: Partial<CadStatement>): CadStatement {
  return {
    id: 'st_part1_1',
    op: 'box',
    args: {},
    inputs: [],
    feature: { kind: 'primitive', label: 'box', createdBy: 'user' },
    ...partial,
  }
}

function makeScript(statements: CadStatement[], partId = 'part1'): PartScript {
  return { partId, params: [], statements }
}

// ── statementToCode ──

describe('codegen: statementToCode 基础体', () => {
  it('box：size 为 vec3 输出数组', () => {
    const stmt = makeStmt({ op: 'box', args: { size: [10, 10, 10] } })
    expect(statementToCode(stmt)).toBe('cad.box({ size:[10,10,10] })')
  })

  it('box：size 为数字输出标量', () => {
    const stmt = makeStmt({ op: 'box', args: { size: 20 } })
    expect(statementToCode(stmt)).toBe('cad.box({ size:20 })')
  })

  it('box：含 center 输出', () => {
    const stmt = makeStmt({ op: 'box', args: { size: [10, 10, 10], center: [1, 2, 3] } })
    expect(statementToCode(stmt)).toBe('cad.box({ size:[10,10,10], center:[1,2,3] })')
  })

  it('sphere / cylinder / cone / wedge', () => {
    expect(statementToCode(makeStmt({ op: 'sphere', args: { radius: 5, segments: 32 } })))
      .toBe('cad.sphere({ radius:5, segments:32 })')
    expect(statementToCode(makeStmt({ op: 'cylinder', args: { radius: 2, height: 10, segments: 32 } })))
      .toBe('cad.cylinder({ radius:2, height:10, segments:32 })')
    expect(statementToCode(makeStmt({ op: 'cone', args: { radiusBottom: 5, radiusTop: 1, height: 10, segments: 32 } })))
      .toBe('cad.cone({ radiusBottom:5, radiusTop:1, height:10, segments:32 })')
    expect(statementToCode(makeStmt({ op: 'wedge', args: { width: 10, height: 5, angle: 60, length: 20 } })))
      .toBe('cad.wedge({ width:10, height:5, angle:60, length:20 })')
  })

  it('sphere：含 center 输出', () => {
    const stmt = makeStmt({ op: 'sphere', args: { radius: 5, segments: 32, center: [3, 4, 0] } })
    expect(statementToCode(stmt)).toBe('cad.sphere({ radius:5, segments:32, center:[3,4,0] })')
  })

  it('cylinder：含 center 输出', () => {
    const stmt = makeStmt({ op: 'cylinder', args: { radius: 2, height: 10, segments: 32, center: [10, 0, 0] } })
    expect(statementToCode(stmt)).toBe('cad.cylinder({ radius:2, height:10, segments:32, center:[10,0,0] })')
  })

  it('cone：含 center 输出', () => {
    const stmt = makeStmt({ op: 'cone', args: { radiusBottom: 5, radiusTop: 1, height: 10, segments: 32, center: [-5, 3, 0] } })
    expect(statementToCode(stmt)).toBe('cad.cone({ radiusBottom:5, radiusTop:1, height:10, segments:32, center:[-5,3,0] })')
  })

  it('wedge：含 center 输出', () => {
    const stmt = makeStmt({ op: 'wedge', args: { width: 10, height: 5, angle: 60, length: 20, center: [0, 15, 0] } })
    expect(statementToCode(stmt)).toBe('cad.wedge({ width:10, height:5, angle:60, length:20, center:[0,15,0] })')
  })
})

// ── center 参数往返：codegen → parser → 语义一致 ──

describe('codegen: center 参数往返 (codegen → parser)', () => {
  it('sphere 含 center 往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [makeStmt({ id: 'st_p1_1', op: 'sphere', args: { radius: 5, segments: 32, center: [3, 4, 0] } })],
    }
    const code = scriptToCode(script)
    expect(code).toContain('center:[3,4,0]')
    // 往返：parse 回来后 center 应保持不变
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    expect(parsed.statements[0].args.center).toEqual([3, 4, 0])
  })

  it('cylinder 含 center 往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [makeStmt({ id: 'st_p1_1', op: 'cylinder', args: { radius: 2, height: 10, segments: 32, center: [10, 0, 0] } })],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    expect(parsed.statements[0].args.center).toEqual([10, 0, 0])
  })

  it('cone 含 center 往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [makeStmt({ id: 'st_p1_1', op: 'cone', args: { radiusBottom: 5, radiusTop: 1, height: 10, segments: 32, center: [-5, 3, 0] } })],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    expect(parsed.statements[0].args.center).toEqual([-5, 3, 0])
  })

  it('wedge 含 center 往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [makeStmt({ id: 'st_p1_1', op: 'wedge', args: { width: 10, height: 5, angle: 60, length: 20, center: [0, 15, 0] } })],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    expect(parsed.statements[0].args.center).toEqual([0, 15, 0])
  })
})

// ── 多 part 带变换的场景：验证位置信息不丢失 ──

describe('codegen: 多 part 带变换的 sceneToCode', () => {
  it('两个独立 primitive 各带不同 translate → codegen 输出各自的 offset', () => {
    const scriptA: PartScript = {
      partId: 'partA',
      params: [],
      statements: [
        makeStmt({ id: 'st_partA_0', op: 'box', args: { size: 20 } }),
        makeStmt({
          id: 'st_partA_1',
          op: 'translate',
          args: { offset: [10, 0, 0] },
          inputs: ['st_partA_0'],
          feature: { kind: 'transform', label: '移动', createdBy: 'user' },
        }),
      ],
    }
    const scriptB: PartScript = {
      partId: 'partB',
      params: [],
      statements: [
        makeStmt({ id: 'st_partB_0', op: 'sphere', args: { radius: 10, center: [30, 0, 0] } }),
        makeStmt({
          id: 'st_partB_1',
          op: 'translate',
          args: { offset: [0, 15, 0] },
          inputs: ['st_partB_0'],
          feature: { kind: 'transform', label: '移动', createdBy: 'user' },
        }),
      ],
    }
    const code = sceneToCode([scriptA, scriptB])
    // partA 的 translate offset
    expect(code).toContain('offset:[10,0,0]')
    // partB 的 translate offset
    expect(code).toContain('offset:[0,15,0]')
    // partB 的 center 参数
    expect(code).toContain('center:[30,0,0]')
    // 两个终端
    expect(code).toContain('return [')
  })

  it('多 part 带 center + translate → 合法 JS（acorn 不抛错）', () => {
    const scriptA: PartScript = {
      partId: 'partA',
      params: [],
      statements: [
        makeStmt({ id: 'st_partA_0', op: 'box', args: { size: 20, center: [5, 0, 0] } }),
        makeStmt({
          id: 'st_partA_1',
          op: 'translate',
          args: { offset: [10, 0, 0] },
          inputs: ['st_partA_0'],
          feature: { kind: 'transform', label: '移动', createdBy: 'user' },
        }),
      ],
    }
    const scriptB: PartScript = {
      partId: 'partB',
      params: [],
      statements: [
        makeStmt({ id: 'st_partB_0', op: 'cylinder', args: { radius: 5, height: 20, center: [0, 20, 0] } }),
      ],
    }
    const code = sceneToCode([scriptA, scriptB])
    expect(() => acornParse(code, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
  })
})

describe('codegen: statementToCode 变换', () => {
  it('translate', () => {
    const stmt = makeStmt({ op: 'translate', args: { offset: [1, 2, 3] } })
    expect(statementToCode(stmt)).toBe('cad.translate({ offset:[1,2,3] })')
  })

  it('rotate：含 pivot', () => {
    const stmt = makeStmt({ op: 'rotate', args: { anglesDeg: [0, 0, 90], pivot: [0, 0, 0] } })
    expect(statementToCode(stmt)).toBe('cad.rotate({ anglesDeg:[0,0,90], pivot:[0,0,0] })')
  })

  it('scale：标量与 vec3', () => {
    expect(statementToCode(makeStmt({ op: 'scale', args: { factor: 2 } }))).toBe('cad.scale({ factor:2 })')
    expect(statementToCode(makeStmt({ op: 'scale', args: { factor: [1, 2, 2] } }))).toBe('cad.scale({ factor:[1,2,2] })')
  })
})

describe('codegen: statementToCode 钻孔', () => {
  it('drill：通孔省略 holeType/tolerance 默认值', () => {
    const stmt = makeStmt({
      op: 'drill',
      args: {
        diameter: 5,
        depth: 0,
        holeType: 'simple',
        tolerance: 0.3,
        position: [0, 0, 10],
        faceNormal: [0, 0, 1],
      },
    })
    expect(statementToCode(stmt)).toBe('cad.drill({ diameter:5, depth:0, position:[0,0,10], faceNormal:[0,0,1] })')
  })

  it('drill：盲孔含 holeType 与自定义 tolerance', () => {
    const stmt = makeStmt({
      op: 'drill',
      args: {
        diameter: 6,
        depth: 8,
        holeType: 'simple',
        tolerance: 0.1,
        position: [0, 0, 10],
        faceNormal: [0, 0, 1],
      },
    })
    expect(statementToCode(stmt)).toBe(
      'cad.drill({ diameter:6, depth:8, position:[0,0,10], faceNormal:[0,0,1], tolerance:0.1 })',
    )
  })

  it('drill：螺丝孔输出 screw 参数', () => {
    const stmt = makeStmt({
      op: 'drill',
      args: {
        diameter: 5,
        depth: 0,
        holeType: 'screw',
        tolerance: 0.3,
        position: [0, 0, 10],
        faceNormal: [0, 0, 1],
        screwSystem: 'metric',
        screwSpecIdx: 4,
        screwThread: 'coarse',
        screwHead: 'none',
      },
    })
    expect(statementToCode(stmt)).toBe(
      "cad.drill({ diameter:5, depth:0, position:[0,0,10], faceNormal:[0,0,1], holeType:'screw', " +
        "screwSystem:'metric', screwSpecIdx:4, screwThread:'coarse', screwHead:'none' })",
    )
  })
})

describe('codegen: statementToCode 分割', () => {
  it('split：默认 normal=[0,0,1] 省略，offset=0 省略', () => {
    const stmt = makeStmt({
      op: 'split',
      args: {
        cutMode: 'plane',
        normal: [0, 0, 1],
        offset: 0,
        inPlaneAngleDeg: 0,
        side: 'front',
      },
      inputs: ['st_part1_0'],
    })
    expect(statementToCode(stmt)).toBe("cad.split({ side:'front' })")
  })

  it('split：非默认 normal 和 offset 输出', () => {
    const stmt = makeStmt({
      op: 'split',
      args: {
        cutMode: 'plane',
        normal: [0, -1, 0],
        offset: 5,
        inPlaneAngleDeg: 0,
        side: 'back',
      },
    })
    const code = statementToCode(stmt)
    expect(code).toContain('normal:[0,-1,0]')
    expect(code).toContain('offset:5')
    expect(code).toContain("side:'back'")
  })

  it('split：非 plane cutMode 输出 cutMode', () => {
    const stmt = makeStmt({
      op: 'split',
      args: {
        cutMode: 'dovetail',
        normal: [0, 0, 1],
        offset: 3,
        inPlaneAngleDeg: 0,
        side: 'front',
        grooveDepth: 4,
        grooveWidth: 2,
      },
    })
    const code = statementToCode(stmt)
    expect(code).toContain("cutMode:'dovetail'")
  })
})

describe('codegen: statementToCode 拉伸/布尔/雕刻/导入', () => {
  it('extrude：默认 mode 省略', () => {
    expect(statementToCode(makeStmt({ op: 'extrude', args: { length: 10, mode: 'centered' } })))
      .toBe('cad.extrude({ length:10 })')
    expect(statementToCode(makeStmt({ op: 'extrude', args: { length: 10, mode: 'forward' } })))
      .toBe("cad.extrude({ length:10, mode:'forward' })")
  })

  it('boolean：输出 cad.operation(inputs)', () => {
    const stmt = makeStmt({
      op: 'boolean',
      args: { operation: 'subtract', sourcePartIds: ['p1', 'p2'] },
      inputs: ['st_part1_1', 'st_part1_2'],
      feature: { kind: 'boolean', label: 'boolean', createdBy: 'user' },
    })
    expect(statementToCode(stmt)).toBe('cad.subtract(st_part1_1, st_part1_2)')
  })

  it('engrave：文本雕刻', () => {
    const stmt = makeStmt({
      op: 'engrave',
      args: { text: 'Hello', depth: 2, textSize: 10 },
      feature: { kind: 'engrave', label: 'engrave', createdBy: 'user' },
    })
    expect(statementToCode(stmt)).toBe("cad.engrave({ text:'Hello', depth:2, textSize:10 })")
  })

  it('engrave：空 text 省略', () => {
    const stmt = makeStmt({
      op: 'engrave',
      args: { text: '', depth: 2, textSize: 10 },
      feature: { kind: 'engrave', label: 'engrave', createdBy: 'user' },
    })
    expect(statementToCode(stmt)).toBe('cad.engrave({ depth:2, textSize:10 })')
  })

  it('load：输出 key', () => {
    const stmt = makeStmt({
      op: 'load',
      args: { key: 'box_boss.glb' },
      feature: { kind: 'load', label: '导入文件', createdBy: 'user' },
    })
    expect(statementToCode(stmt)).toBe("cad.load({ key:'box_boss.glb' })")
  })

  it('load：输出 path + format', () => {
    const stmt = makeStmt({
      op: 'load',
      args: { path: '/Users/me/models/bracket.step', format: 'step' },
      feature: { kind: 'load', label: '导入文件', createdBy: 'user' },
    })
    expect(statementToCode(stmt)).toBe("cad.load({ path:'/Users/me/models/bracket.step', format:'step' })")
  })

  it('load：输出 url', () => {
    const stmt = makeStmt({
      op: 'load',
      args: { url: 'https://cdn.example.com/bracket.glb', format: 'glb' },
      feature: { kind: 'load', label: '导入文件', createdBy: 'user' },
    })
    expect(statementToCode(stmt)).toBe("cad.load({ url:'https://cdn.example.com/bracket.glb', format:'glb' })")
  })

  it('未知 op：兜底输出全部 args', () => {
    const stmt = makeStmt({ op: 'unknown-op', args: { a: 1, b: 'x' } })
    expect(statementToCode(stmt)).toBe("cad.unknown-op({ a:1, b:'x' })")
  })
})

describe('codegen: 值格式化', () => {
  it('GeomRef → cad.faceCenter(of)', () => {
    const stmt = makeStmt({
      op: 'drill',
      args: {
        position: { $geom: { of: 'st_part1_0', feature: 'faceCenter' } },
        faceNormal: { $geom: { of: 'st_part1_0', feature: 'faceNormal' } },
      },
    })
    const code = statementToCode(stmt)
    expect(code).toContain('position:cad.faceCenter(st_part1_0)')
    expect(code).toContain('faceNormal:cad.faceNormal(st_part1_0)')
  })

it('GeomRef with anchor → cad.faceCenter(of, [..])', () => {
const stmt = makeStmt({
op: 'drill',
args: {
position: { $geom: { of: 'st_part1_0', feature: 'faceCenter', anchor: { point: [1, 2, 3] } } },
},
})
expect(statementToCode(stmt)).toContain('position:cad.faceCenter(st_part1_0, [1,2,3])')
})

it('GeomRef with faceOrdinal → cad.faceCenter(of, [..], ordinal)', () => {
const stmt = makeStmt({
op: 'drill',
args: {
position: { $geom: { of: 'st_part1_0', feature: 'faceCenter', faceOrdinal: 3, anchor: { point: [1, 2, 3] } } },
},
})
expect(statementToCode(stmt)).toContain('position:cad.faceCenter(st_part1_0, [1,2,3], 3)')
})

it('GeomRef with faceOrdinal but no anchor → cad.faceCenter(of, null, ordinal)', () => {
const stmt = makeStmt({
op: 'drill',
args: {
position: { $geom: { of: 'st_part1_0', feature: 'faceCenter', faceOrdinal: 2 } },
},
})
expect(statementToCode(stmt)).toContain('position:cad.faceCenter(st_part1_0, null, 2)')
})

it('GeomRef with faceOrdinal round-trip: codegen → parse → same args', () => {
// 使用 partN_vM 格式的语句 ID（与 parser 产出一致），确保 codegen→parse 往返保真
const script = makeScript([
{ id: 'part1_v0', op: 'box', args: { size: [10, 10, 10] }, inputs: [], feature: { kind: 'primitive', label: 'box', createdBy: 'user' } },
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
  feature: { kind: 'engrave', label: '雕刻 "test"', createdBy: 'user' },
},
])
const fullCode = scriptToCode(script)
const parsed = parseScript(fullCode)
const parsedStmt = parsed.script.statements[1]
expect(parsedStmt.args.faceCenter).toEqual({
$geom: { of: 'part1_v0', feature: 'faceCenter', faceOrdinal: 4, anchor: { point: [5, 5, 10] } },
})
expect(parsedStmt.args.faceNormal).toEqual({
$geom: { of: 'part1_v0', feature: 'faceNormal', faceOrdinal: 4, anchor: { point: [5, 5, 10] } },
})
})

  it('ParamRef → 裸标识符（无 $ 前缀）', () => {
    const stmt = makeStmt({ op: 'box', args: { size: { $param: 'boxSize' } } })
    expect(statementToCode(stmt)).toBe('cad.box({ size:boxSize })')
  })

  it('字符串含单引号被转义', () => {
    const stmt = makeStmt({ op: 'engrave', args: { text: "it's", depth: 1 } })
    expect(statementToCode(stmt)).toBe("cad.engrave({ text:'it\\'s', depth:1 })")
  })

  it('fmtNum：整数直出、小数去尾零', () => {
    expect(fmtNum(20)).toBe('20')
    expect(fmtNum(0.1)).toBe('0.1')
    expect(fmtNum(0.30000000000000004)).toBe('0.3')
    expect(fmtNum(1.5)).toBe('1.5')
    expect(fmtNum(-0)).toBe('0')
  })
})

// ── scriptToCode ──

describe('codegen: scriptToCode', () => {
  it('顺序拼接：apiVersion + load 源标注 + return', () => {
    const script = makeScript([
      makeStmt({
        id: 'st_part1_0',
        op: 'load',
        args: { key: 'box_boss.glb' },
        feature: { kind: 'load', label: '导入文件', createdBy: 'user' },
      }),
      makeStmt({ id: 'st_part1_1', op: 'box', args: { size: [10, 10, 10] } }),
      makeStmt({
        id: 'st_part1_2',
        op: 'translate',
        args: { offset: [1, 2, 3] },
        inputs: ['st_part1_1'],
        feature: { kind: 'transform', label: '移动', createdBy: 'user' },
      }),
    ])
    const code = scriptToCode(script)
    expect(code).toBe(
      '// apiVersion: 1\n' +
        'export default async (cad) => {\n' +
        '  // source: load box_boss.glb\n' +
        "  const part0_v0 = await cad.load({ key:'box_boss.glb' })\n" +
        '  const part0_v1 = await cad.box({ size:[10,10,10] })\n' +
        '  const part0_v2 = await cad.translate(part0_v1, { offset:[1,2,3] })\n' +
        '  return { shape: part0_v2 }\n' +
        '}',
    )
  })

  it('多级依赖：连续下游语句引用前一条，异步 op 加 await', () => {
    const script = makeScript([
      makeStmt({ id: 's0', op: 'box', args: { size: 20 } }),
      makeStmt({ id: 's1', op: 'translate', args: { offset: [0, 0, 5] }, inputs: ['s0'] }),
      makeStmt({
        id: 's2',
        op: 'drill',
        args: { diameter: 5, depth: 0 },
        inputs: ['s1'],
        feature: { kind: 'drill', label: '钻孔', createdBy: 'user' },
      }),
    ])
    const code = scriptToCode(script)
    expect(code).toBe(
      '// apiVersion: 1\n' +
        'export default async (cad) => {\n' +
        '  const part0_v0 = await cad.box({ size:20 })\n' +
        '  const part0_v1 = await cad.translate(part0_v0, { offset:[0,0,5] })\n' +
        '  const part0_v2 = await cad.drill(part0_v1, { diameter:5, depth:0 })\n' +
        '  return { shape: part0_v2 }\n' +
        '}',
    )
  })

  it('空脚本：输出合法 JS 容器', () => {
    expect(scriptToCode(makeScript([]))).toBe(
      '// apiVersion: 1\nexport default async (cad) => {}',
    )
  })

  it('load by path：source 注释 + await + path', () => {
    const script = makeScript([
      makeStmt({
        id: 'st_part1_0',
        op: 'load',
        args: { path: '/Users/me/models/bracket.step', format: 'step' },
        feature: { kind: 'load', label: '导入文件', createdBy: 'user' },
      }),
    ])
    const code = scriptToCode(script)
    expect(code).toContain('// source: load /Users/me/models/bracket.step')
    expect(code).toContain("const part0_v0 = await cad.load({ path:'/Users/me/models/bracket.step', format:'step' })")
  })

  it('load by url：source 注释 + await + url', () => {
    const script = makeScript([
      makeStmt({
        id: 'st_part1_0',
        op: 'load',
        args: { url: 'https://cdn.example.com/bracket.glb', format: 'glb' },
        feature: { kind: 'load', label: '导入文件', createdBy: 'user' },
      }),
    ])
    const code = scriptToCode(script)
    expect(code).toContain('// source: load https://cdn.example.com/bracket.glb')
    expect(code).toContain("const part0_v0 = await cad.load({ url:'https://cdn.example.com/bracket.glb', format:'glb' })")
  })

  it('load by key：source 注释 + await + key', () => {
    const script = makeScript([
      makeStmt({
        id: 'st_part1_0',
        op: 'load',
        args: { key: 'f3a9c1', format: 'step' },
        feature: { kind: 'load', label: '导入文件', createdBy: 'user' },
      }),
    ])
    const code = scriptToCode(script)
    expect(code).toContain('// source: load f3a9c1')
    expect(code).toContain("const part0_v0 = await cad.load({ key:'f3a9c1', format:'step' })")
  })

  it('含 meta 的脚本输出 return { shape, name, color, ... }', () => {
    const script: PartScript = {
      partId: 'part1',
      params: [],
      statements: [makeStmt({ id: 's0', op: 'box', args: { size: 20 } })],
      meta: { name: '支架底板', appearance: { color: '#4A90D9', metalness: 0.3, roughness: 0.6 } },
    }
    const code = scriptToCode(script)
    expect(code).toContain("return { shape: part0_v0, name: '支架底板', color: '#4A90D9', metalness: 0.3, roughness: 0.6 }")
  })

  it('含 param 声明的脚本', () => {
    const script: PartScript = {
      partId: 'part1',
      params: [{ name: 'size', type: 'number', value: 20, default: 20 }],
      statements: [makeStmt({ id: 's0', op: 'box', args: { size: { $param: 'size' } } })],
    }
    const code = scriptToCode(script)
    expect(code).toContain('const size = 20')
    expect(code).toContain('const part0_v0 = await cad.box({ size:size })')
  })

  it('boolean op 输出 cad.union(inputs)', () => {
    const script = makeScript([
      makeStmt({ id: 's0', op: 'box', args: { size: 20 } }),
      makeStmt({ id: 's1', op: 'sphere', args: { radius: 10 } }),
      makeStmt({
        id: 's2',
        op: 'boolean',
        args: { operation: 'union', sourcePartIds: ['s0', 's1'] },
        inputs: ['s0', 's1'],
        feature: { kind: 'boolean', label: '合并', createdBy: 'user' },
      }),
    ])
    const code = scriptToCode(script)
    expect(code).toContain('const part0_v2 = await cad.union(part0_v0, part0_v1)')
  })
})

// ── 多 mesh：split 解构 / 多终端 return / sceneToCode ──

describe('codegen: split 解构输出', () => {
  it('多输出 split 输出 const { front: part1_v0, back: part2_v0 } = await cad.split(...)', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [
        makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
        makeStmt({
          id: 'part0_v1',
          op: 'translate',
          args: { offset: [0, 0, 5] },
          inputs: ['part0_v0'],
          feature: { kind: 'transform', label: '移动', createdBy: 'user' },
        }),
        makeStmt({
          id: 'part1_v0',
          op: 'split',
          args: {
            cutMode: 'plane',
            normal: [0, 0, 1],
            offset: 0,
            inPlaneAngleDeg: 0,
            side: 'front',
          },
          inputs: ['part0_v1'],
          feature: { kind: 'split', label: 'split', createdBy: 'user' },
          outputs: ['part1_v0', 'part2_v0'],
        }),
      ],
      terminalShapes: [
        { id: 'part1_v0', meta: { name: 'Front' } },
        { id: 'part2_v0', meta: { name: 'Back' } },
      ],
    }
    const code = scriptToCode(script)
    // 解构语法 — 多输出 split 过滤 side，默认 normal/offset/inPlaneAngleDeg/cutMode 被省略
    expect(code).toContain('const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v1)')
    // 多终端 return 数组
    expect(code).toContain('return [')
    expect(code).toContain('{ shape: part1_v0, name: \'Front\' }')
    expect(code).toContain('{ shape: part2_v0, name: \'Back\' }')
  })

  it('单终端 terminalShapes 仍输出 return { shape, ... }', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } })],
      terminalShapes: [
        { id: 'part0_v0', meta: { name: 'Box', appearance: { color: '#FF0000' } } },
      ],
    }
    const code = scriptToCode(script)
    expect(code).toContain("return { shape: part0_v0, name: 'Box', color: '#FF0000' }")
  })
})

describe('codegen: sceneToCode 多 PartScript 合并', () => {
  it('两个独立 PartScript 合并为单一 DAG', () => {
    const scriptA: PartScript = {
      partId: 'partA',
      params: [],
      statements: [makeStmt({ id: 'st_partA_0', op: 'box', args: { size: 20 } })],
    }
    const scriptB: PartScript = {
      partId: 'partB',
      params: [],
      statements: [makeStmt({ id: 'st_partB_0', op: 'sphere', args: { radius: 10 } })],
    }
    const code = sceneToCode([scriptA, scriptB])
    // 两个终端输出
    expect(code).toContain('cad.box({ size:20 })')
    expect(code).toContain('cad.sphere({ radius:10 })')
    // return 数组格式（2 个终端）
    expect(code).toContain('return [')
    expect(code).toContain('shape: part0_v0')
    expect(code).toContain('shape: part1_v0')
  })

  it('单个 PartScript 退化为 scriptToCode', () => {
    const script: PartScript = {
      partId: 'partA',
      params: [],
      statements: [makeStmt({ id: 'st_partA_0', op: 'box', args: { size: 20 } })],
      meta: { name: 'MyBox' },
    }
    const code = sceneToCode([script])
    expect(code).toContain("name: 'MyBox'")
    expect(code).toContain('cad.box({ size:20 })')
    // 单终端不输出数组
    expect(code).not.toContain('return [')
  })

  it('跨 Part 引用：scriptB 引用 scriptA 的输出', () => {
    const scriptA: PartScript = {
      partId: 'partA',
      params: [],
      statements: [makeStmt({ id: 'st_partA_0', op: 'box', args: { size: 20 } })],
    }
    const scriptB: PartScript = {
      partId: 'partB',
      params: [],
      statements: [
        makeStmt({
          id: 'st_partB_0',
          op: 'translate',
          args: { offset: [5, 0, 0] },
          inputs: ['st_partA_0'],
          feature: { kind: 'transform', label: '移动', createdBy: 'user' },
        }),
      ],
    }
    const code = sceneToCode([scriptA, scriptB])
    // 拓扑序：partA 在前，partB 在后
    const boxIdx = code.indexOf('cad.box')
    const translateIdx = code.indexOf('cad.translate')
    expect(boxIdx).toBeGreaterThan(-1)
    expect(translateIdx).toBeGreaterThan(boxIdx)
    // translate 引用 box 的输出（part0_v0）
    expect(code).toContain('cad.translate(part0_v0')
  })

  it('空数组返回合法 JS 容器', () => {
    const code = sceneToCode([])
    expect(code).toBe('// apiVersion: 1\nexport default async (cad) => {}')
  })
})

// ── 回归测试：外部 st_ id 含冒号时必须报错（不准偷偷兜底） ──

describe('codegen: 外部 st_ id 含冒号时报错', () => {
  it('split 引用无法解析的外部 id 时抛错（不准兜底）', () => {
    // 复现 bug：split 的新 part 引用源 part 的语句 id（含冒号），
    // 但该语句不在当前 PartScript 中 → codegen 必须报错
    const script: PartScript = {
      partId: 'front_part',
      params: [],
      statements: [
        makeStmt({
          id: 'st_front_1',
          op: 'split',
          inputs: ['st_prim_panel_1:o1_1'],
          args: {
            normal: [0, 0, 1],
            offset: 0,
            inPlaneAngleDeg: 0,
            side: 'front',
            bbCenter: [0, 0, 0],
            bboxSize: [20, 20, 20],
          },
          feature: { kind: 'split', label: '分割', createdBy: 'user' },
        }),
      ],
    }
    // 必须抛错——unresolved input reference，不准偷偷兜底
    expect(() => scriptToCode(script)).toThrow(/unresolved input reference/)
  })

  it('drill 引用无法解析的外部 id 时也抛错', () => {
    const script: PartScript = {
      partId: 'drilled_part',
      params: [],
      statements: [
        makeStmt({
          id: 'st_drilled_1',
          op: 'drill',
          inputs: ['st_source_part:o1_1'],
          args: {
            diameter: 5,
            depth: 0,
            position: [0, 0, 0],
            faceNormal: [0, 0, 1],
          },
          feature: { kind: 'drill', label: '钻孔', createdBy: 'user' },
        }),
      ],
    }
    expect(() => scriptToCode(script)).toThrow(/unresolved input reference/)
  })

  it('包含自包含依赖语句时生成合法 JS', () => {
    // 正常场景：源 part 的图元语句 + split 语句在同一 PartScript 中
    // （模拟 getScriptText 收集外部依赖后的场景）
    const script: PartScript = {
      partId: 'front_part',
      params: [],
      statements: [
        makeStmt({
          id: 'st_source_1',
          op: 'cylinder',
          args: { radius: 5, height: 40 },
          inputs: [],
          feature: { kind: 'primitive', label: 'cylinder', createdBy: 'user' },
        }),
        makeStmt({
          id: 'st_front_1',
          op: 'split',
          inputs: ['st_source_1'],
          args: {
            normal: [0, 0, 1],
            offset: 0,
            inPlaneAngleDeg: 0,
            side: 'front',
            bbCenter: [0, 0, 0],
            bboxSize: [20, 20, 20],
          },
          feature: { kind: 'split', label: '分割', createdBy: 'user' },
        }),
      ],
    }
    const code = scriptToCode(script)

    // cylinder 输出变量名（part0_v0），split 引用 part0_v0
    expect(code).toContain('cad.cylinder(')
    expect(code).toContain('cad.split(part0_v0')

    // 必须是合法 JS
    expect(() => acornParse(code, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
  })
})

// ── §3.3: 变换语句 codegen 验证（含 cad.translate/rotate/scale 行） ──

describe('codegen: transform 语句进 .faijs', () => {
  it('box + translate + rotate + scale → 含 cad.translate/rotate/scale 行', () => {
    const script = makeScript([
      makeStmt({ id: 's0', op: 'box', args: { size: 20 } }),
      makeStmt({
        id: 's1', op: 'translate', args: { offset: [10, 0, 0] },
        inputs: ['s0'], feature: { kind: 'transform', label: '移动', createdBy: 'user' },
      }),
      makeStmt({
        id: 's2', op: 'rotate', args: { anglesDeg: [0, 0, 90] },
        inputs: ['s1'], feature: { kind: 'transform', label: '旋转', createdBy: 'user' },
      }),
      makeStmt({
        id: 's3', op: 'scale', args: { factor: 2 },
        inputs: ['s2'], feature: { kind: 'transform', label: '缩放', createdBy: 'user' },
      }),
    ])
    const code = scriptToCode(script)
    expect(code).toContain('cad.translate(part0_v0, { offset:[10,0,0] })')
    expect(code).toContain('cad.rotate(part0_v1, { anglesDeg:[0,0,90] })')
    expect(code).toContain('cad.scale(part0_v2, { factor:2 })')
    expect(code).toContain('return { shape: part0_v3 }')
  })

  it('transform codegen → acorn 解析合法（J-1）', () => {
    const script = makeScript([
      makeStmt({ id: 's0', op: 'box', args: { size: 20 } }),
      makeStmt({
        id: 's1', op: 'translate', args: { offset: [5, 5, 5] },
        inputs: ['s0'], feature: { kind: 'transform', label: '移动', createdBy: 'user' },
      }),
    ])
    const code = scriptToCode(script)
    // acorn 不抛错即合法
    const body = code.replace(/^\/\/ apiVersion: 1\n/, '')
    expect(() => acornParse(body, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
  })
})
