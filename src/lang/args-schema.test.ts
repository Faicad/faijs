/**
 * args-schema 单元测试 — 语句参数校验（D-10）
 *
 * 覆盖：
 * - 创建类 op 的必需/可选字段校验（box/sphere/cylinder/cone/wedge）
 * - 变换类 op 的 inputs 数量校验（translate/rotate/scale）
 * - 特征类 op 的参数校验（drill/extrude/split/boolean/engrave）
 * - 类型校验（number/vec3/string/boolean/any/numberOrVec3）
 * - cone 参数名 A-1 回归：radiusBottom/radiusTop 而非 radius
 * - validateScriptArgs 多语句批量校验
 * - getOpSchema / hasOpSchema
 */

import { describe, it, expect } from 'vitest'
import {
  validateStatementArgs,
  validateScriptArgs,
  getOpSchema,
  hasOpSchema,
} from './args-schema'
import type { CadStatement } from './types'

// ── 测试辅助 ──

function makeStmt(partial: Partial<CadStatement>): CadStatement {
  return {
    id: 'st_test_1',
    op: 'box',
    args: {},
    inputs: [],
    feature: { kind: 'primitive', label: 'box', createdBy: 'user' },
    ...partial,
  }
}

// ── 创建类 ──

describe('args-schema: 创建类', () => {
  it('box：合法参数通过', () => {
    const stmt = makeStmt({ op: 'box', args: { size: 20 } })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('box：vec3 size 通过', () => {
    const stmt = makeStmt({ op: 'box', args: { size: [10, 20, 30] } })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('box：缺少 size 报错', () => {
    const stmt = makeStmt({ op: 'box', args: {} })
    const errors = validateStatementArgs(stmt)
    expect(errors).toHaveLength(1)
    expect(errors[0].field).toBe('size')
    expect(errors[0].message).toContain('missing required field')
  })

  it('box：带 center 通过', () => {
    const stmt = makeStmt({ op: 'box', args: { size: 20, center: [1, 2, 3] } })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('sphere：合法参数通过', () => {
    const stmt = makeStmt({ op: 'sphere', args: { radius: 5, segments: 32 } })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('sphere：缺少 radius 报错', () => {
    const stmt = makeStmt({ op: 'sphere', args: { segments: 32 } })
    const errors = validateStatementArgs(stmt)
    expect(errors).toHaveLength(1)
    expect(errors[0].field).toBe('radius')
  })

  it('cylinder：合法参数通过', () => {
    const stmt = makeStmt({ op: 'cylinder', args: { radius: 2, height: 10 } })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('cone：radiusBottom/radiusTop 而非 radius（A-1 回归）', () => {
    // 正确参数名
    const validStmt = makeStmt({
      op: 'cone',
      args: { radiusBottom: 5, radiusTop: 1, height: 10 },
    })
    expect(validateStatementArgs(validStmt)).toEqual([])

    // 旧错误参数名（只有 radius）应报错
    const invalidStmt = makeStmt({
      op: 'cone',
      args: { radius: 5, height: 10 },
    })
    const errors = validateStatementArgs(invalidStmt)
    expect(errors.length).toBeGreaterThanOrEqual(2)
    const fields = errors.map((e) => e.field)
    expect(fields).toContain('radiusBottom')
    expect(fields).toContain('radiusTop')
  })

  it('wedge：合法参数通过', () => {
    const stmt = makeStmt({ op: 'wedge', args: { width: 10, height: 5, angle: 60, length: 20 } })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('text：合法参数通过', () => {
    const stmt = makeStmt({ op: 'text', args: { text: 'Hello', size: 10, depth: 2 } })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

it('load：合法参数通过', () => {
const stmt = makeStmt({ op: 'load', args: { key: 'model.glb' } })
expect(validateStatementArgs(stmt)).toEqual([])
})
})

// ── 变换类 ──

describe('args-schema: 变换类', () => {
  it('translate：合法参数 + inputs 通过', () => {
    const stmt = makeStmt({
      op: 'translate',
      args: { offset: [1, 2, 3] },
      inputs: ['st_test_0'],
    })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('translate：缺少 inputs 报错', () => {
    const stmt = makeStmt({ op: 'translate', args: { offset: [1, 2, 3] } })
    const errors = validateStatementArgs(stmt)
    expect(errors).toHaveLength(1)
    expect(errors[0].field).toBe('inputs')
  })

  it('rotate：合法参数通过', () => {
    const stmt = makeStmt({
      op: 'rotate',
      args: { anglesDeg: [0, 0, 90] },
      inputs: ['st_test_0'],
    })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('scale：vec3 factor 通过', () => {
    const stmt = makeStmt({
      op: 'scale',
      args: { factor: [1, 2, 2] },
      inputs: ['st_test_0'],
    })
    expect(validateStatementArgs(stmt)).toEqual([])
  })
})

// ── 特征类 ──

describe('args-schema: 特征类', () => {
  it('drill：合法参数 + inputs 通过', () => {
    const stmt = makeStmt({
      op: 'drill',
      args: { diameter: 5, depth: 0, position: [0, 0, 10], faceNormal: [0, 0, 1] },
      inputs: ['st_test_0'],
    })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('drill：缺少 diameter 报错', () => {
    const stmt = makeStmt({
      op: 'drill',
      args: { depth: 0 },
      inputs: ['st_test_0'],
    })
    const errors = validateStatementArgs(stmt)
    expect(errors.some((e) => e.field === 'diameter')).toBe(true)
  })

  it('extrude：合法参数 + inputs 通过', () => {
    const stmt = makeStmt({
      op: 'extrude',
      args: { length: 10, mode: 'forward', normal: [0, 0, 1], originOffset: 0 },
      inputs: ['st_test_0'],
    })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('split：合法参数 + inputs 通过', () => {
    const stmt = makeStmt({
      op: 'split',
      args: { cutMode: 'plane', normal: [0, 0, 1], offset: 0, inPlaneAngleDeg: 0 },
      inputs: ['st_test_0'],
    })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('boolean：合法参数 + inputs 通过', () => {
    const stmt = makeStmt({
      op: 'boolean',
      args: { operation: 'subtract' },
      inputs: ['st_test_0', 'st_test_1'],
    })
    expect(validateStatementArgs(stmt)).toEqual([])
  })

  it('boolean：缺少 operation 报错', () => {
    const stmt = makeStmt({
      op: 'boolean',
      args: {},
      inputs: ['st_test_0'],
    })
    const errors = validateStatementArgs(stmt)
    expect(errors.some((e) => e.field === 'operation')).toBe(true)
  })

  it('engrave：合法参数 + inputs 通过', () => {
    const stmt = makeStmt({
      op: 'engrave',
      args: { text: 'Hello', depth: 2, textSize: 10 },
      inputs: ['st_test_0'],
    })
    expect(validateStatementArgs(stmt)).toEqual([])
  })
})

// ── 类型校验 ──

describe('args-schema: 类型校验', () => {
  it('number 类型不匹配报错', () => {
    const stmt = makeStmt({ op: 'sphere', args: { radius: 'not-a-number' as never } })
    const errors = validateStatementArgs(stmt)
    expect(errors.some((e) => e.field === 'radius')).toBe(true)
  })

  it('vec3 类型不匹配报错', () => {
    const stmt = makeStmt({
      op: 'translate',
      args: { offset: 'not-vec3' as never },
      inputs: ['st_test_0'],
    })
    const errors = validateStatementArgs(stmt)
    expect(errors.some((e) => e.field === 'offset')).toBe(true)
  })

  it('vec3 长度不对报错', () => {
    const stmt = makeStmt({
      op: 'translate',
      args: { offset: [1, 2] as never },
      inputs: ['st_test_0'],
    })
    const errors = validateStatementArgs(stmt)
    expect(errors.some((e) => e.field === 'offset')).toBe(true)
  })
})

// ── 批量校验 ──

describe('args-schema: validateScriptArgs', () => {
  it('多条语句全部通过返回空数组', () => {
    const stmts = [
      makeStmt({ id: 's1', op: 'box', args: { size: 20 } }),
      makeStmt({
        id: 's2',
        op: 'translate',
        args: { offset: [1, 2, 3] },
        inputs: ['s1'],
      }),
    ]
    expect(validateScriptArgs(stmts)).toEqual([])
  })

  it('有错误的语句被收集', () => {
    const stmts = [
      makeStmt({ id: 's1', op: 'box', args: {} }), // missing size
      makeStmt({ id: 's2', op: 'sphere', args: { radius: 5 } }), // ok
    ]
    const results = validateScriptArgs(stmts)
    expect(results).toHaveLength(1)
    expect(results[0].statementId).toBe('s1')
    expect(results[0].errors.length).toBeGreaterThan(0)
  })
})

// ── schema 查询 ──

describe('args-schema: schema 查询', () => {
  it('getOpSchema 返回已知 op 的 schema', () => {
    const schema = getOpSchema('box')
    expect(schema).toBeDefined()
    expect(schema?.op).toBe('box')
    expect(schema?.fields.some((f) => f.name === 'size')).toBe(true)
  })

  it('getOpSchema 返回 undefined for 未知 op', () => {
    expect(getOpSchema('unknown-op')).toBeUndefined()
  })

  it('hasOpSchema 正确判断', () => {
    expect(hasOpSchema('box')).toBe(true)
    expect(hasOpSchema('sphere')).toBe(true)
    expect(hasOpSchema('drill')).toBe(true)
    expect(hasOpSchema('unknown-op')).toBe(false)
  })

  it('cone schema 包含 radiusBottom/radiusTop 而非 radius', () => {
    const schema = getOpSchema('cone')
    expect(schema).toBeDefined()
    const fieldNames = schema!.fields.map((f) => f.name)
    expect(fieldNames).toContain('radiusBottom')
    expect(fieldNames).toContain('radiusTop')
    expect(fieldNames).not.toContain('radius')
  })
})

// ── 未知 op ──

describe('args-schema: 未知 op', () => {
  it('未知 op 不校验，返回空数组', () => {
    const stmt = makeStmt({ op: 'unknown-op', args: {} })
    expect(validateStatementArgs(stmt)).toEqual([])
  })
})
