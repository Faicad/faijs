/**
 * op-set-consistency L0 — schema ↔ codegen ↔ parser 一致性守卫（L0 零依赖）
 *
 * 从 script-engine/op-set-consistency.test.ts 拆分而来。
 * L0 部分仅依赖 @faijs/* 模块，不依赖 replay-validator / brep-chain。
 *
 * L1 部分（replay-validator case 集合、BREP 能力集合）留在
 * src/lang/op-set-consistency.test.ts
 */

import { describe, it, expect } from 'vitest'
import { getOpSchema, hasOpSchema } from './args-schema'
import { buildArgsParts } from './codegen'
import type { CadStatement } from './types'

// ── schema 中的 op 集合 ──
const SCHEMA_OPS = new Set([
'box', 'sphere', 'cylinder', 'cone', 'wedge',
'text', 'screw', 'svgExtrude', 'load',
'translate', 'rotate', 'scale',
'drill', 'extrude', 'split', 'boolean', 'engrave', 'knurl', 'sdf',
])

// ── parser 的 PRIMITIVE_OPS（从 parser.ts:60 提取） ──
const PARSER_PRIMITIVE_OPS = new Set([
  'box', 'sphere', 'cylinder', 'cone', 'wedge', 'text', 'screw', 'svgExtrude',
])

describe('op-set-consistency: parser PRIMITIVE_OPS ⊆ schema', () => {
  it('parser 认识的每个 primitive op 都在 schema 中有定义', () => {
    const missing: string[] = []
    for (const op of PARSER_PRIMITIVE_OPS) {
      if (!hasOpSchema(op)) {
        missing.push(op)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('op-set-consistency: schema op 集合完整性', () => {
it('所有关键 op 都在 schema 中有定义', () => {
const criticalOps = [
'box', 'sphere', 'cylinder', 'cone', 'wedge',
'text', 'screw', 'svgExtrude', 'load',
'translate', 'rotate', 'scale',
'drill', 'extrude', 'split', 'boolean', 'engrave', 'knurl', 'sdf',
]
    for (const op of criticalOps) {
      expect(hasOpSchema(op)).toBe(true)
    }
  })

  it('knurl schema 包含 knurl 专属参数', () => {
    const schema = getOpSchema('knurl')
    expect(schema).toBeDefined()
    const fieldNames = schema!.fields.map((f) => f.name)
    expect(fieldNames).toContain('knurlTextureHeight')
    expect(fieldNames).toContain('knurlScaleU')
    expect(fieldNames).toContain('knurlScaleV')
  })

  it('sdf schema 包含 code 字段', () => {
    const schema = getOpSchema('sdf')
    expect(schema).toBeDefined()
    const fieldNames = schema!.fields.map((f) => f.name)
    expect(fieldNames).toContain('code')
  })
})

// ── schema ↔ codegen 参数键集一致性守卫 ──
// 对于每个 schema 中定义的 op，验证 codegen 的 buildArgsParts 不会遗漏 schema 声明的字段。
// 方法：构造一个所有字段都设为非默认值的 statement，调用 buildArgsParts，
// 检查输出的 key 集合是否覆盖了 schema 声明的所有字段。
// 例外：boolean op 的 args 全部由 codegen 特殊处理（operation→函数名，inputs→位置实参），不进 args 对象。

/**
 * 为每个 op 构造「全部字段非默认值」的 args。
 * 值的选择原则：不命中 codegen 中任何 skip 函数的默认值条件。
 */
const NON_DEFAULT_ARGS: Record<string, Record<string, unknown>> = {
  box: { size: [10, 20, 30], center: [1, 2, 3], nRad: 64 },
  sphere: { radius: 5, segments: 32, center: [1, 2, 3], nRad: 64 },
  cylinder: { radius: 5, height: 10, segments: 32, center: [1, 2, 3], nRad: 64 },
  cone: { radiusBottom: 5, radiusTop: 1, height: 10, segments: 32, center: [1, 2, 3], nRad: 64 },
  wedge: { width: 10, height: 20, angle: 60, length: 50, center: [1, 2, 3], nRad: 64 },
  text: { text: 'hello', size: 10, depth: 2 },
  screw: { system: 'metric', specIdx: 0, thread: 'coarse', pitchCustom: 1.5, length: 10, head: 'none', nRad: 64 },
  svgExtrude: { svg: '<svg></svg>', depth: 5, targetLongSide: 20 },
  load: { key: 'model.3mf', path: '/path/to/file.step', url: 'https://example.com/model.3mf', format: '3mf' },
  translate: { offset: [1, 2, 3] },
  rotate: { anglesDeg: [10, 20, 30], pivot: [1, 2, 3] },
  scale: { factor: [1, 2, 3] },
  drill: {
    diameter: 5, depth: 10, position: [0, 0, 5], faceNormal: [0, 0, 1],
    direction: 'reverse', holeType: 'screw', tolerance: 0.1,
    screwSystem: 'metric', screwSpecIdx: 4, screwThread: 'coarse', screwHead: 'none',
  },
  extrude: { length: 10, mode: 'forward', normal: [0, 0, 1], originOffset: 5, space: 'world' },
  split: {
    cutMode: 'dovetail', normal: [1, 0, 0], offset: 5, inPlaneAngleDeg: 45,
    side: 'front',
    grooveDepth: 4, grooveWidth: 2, grooveDepthTolerance: 0.1, grooveWidthTolerance: 0.1,
    grooveFlapsAngle: 30,
    dowelDiameter: 3, dowelDiameterTolerance: 0.1, dowelHeight: 5, dowelHeightTolerance: 0.1,
    tenonSideLength: 5, tenonSideLengthTolerance: 0.1, tenonHeight: 3, tenonHeightTolerance: 0.1,
    bbCenter: [0, 0, 0], bboxSize: [20, 20, 20],
    selectedSections: [0], applyExplode: true,
    frontPartId: 'p1', backPartId: 'p2',
  },
  boolean: { operation: 'subtract', sourcePartIds: ['p1', 'p2'] },
  engrave: {
    text: 'hello', depth: 2, textSize: 10, svg: { $asset: 'svgkey' }, svgSize: 100,
    mode: 'convex',
    faceCenter: [0, 0, 0], faceNormal: [0, 0, 1],
  },
  knurl: {
    knurlTextureHeight: 2, knurlScaleU: 1, knurlScaleV: 1,
    knurlInvertDisplacement: true, knurlRefineLength: 1, knurlMappingMode: 0,
    faceCenter: [0, 0, 0], faceNormal: [0, 0, 1],
  },
  sdf: { code: 'fn', box: [10, 10, 10], resolution: 32, params: { a: 1 } },
}

/**
 * 从 buildArgsParts 输出中提取 key 名。
 * 例如 'normal:[0,0,1]' → 'normal', 'side:\'front\'' → 'side'
 */
function extractKeys(parts: string[]): Set<string> {
  return new Set(parts.map((p) => p.split(':')[0]))
}

describe('op-set-consistency: schema ↔ codegen 参数键集', () => {
  // boolean 是特殊情况：operation→函数名，inputs→位置实参，不进 args 对象
  const OPS_TO_SKIP = new Set(['boolean'])

  // 已知未实现的 codegen 字段：在 schema 中声明但 codegen 暂不输出
  // 每项为 'op:field' 格式。新增条目时必须附注释说明原因。
  const KNOWN_CODEGEN_PENDING = new Set<string>([
    // P4 全部修复后，此列表应为空
  ])

  it('每个 schema op 的非默认值 statement → buildArgsParts 输出覆盖所有 schema 字段', () => {
    const mismatches: string[] = []
    for (const op of SCHEMA_OPS) {
      if (OPS_TO_SKIP.has(op)) continue

      const schema = getOpSchema(op)
      if (!schema) continue

      const schemaFields = new Set(schema.fields.map((f) => f.name))
      const args = NON_DEFAULT_ARGS[op]
      if (!args) {
        mismatches.push(`${op}: no non-default args defined in test`)
        continue
      }

      const stmt: CadStatement = {
        id: 'st_test',
        op,
        args: args as never,
        inputs: [],
        feature: { kind: 'primitive', label: op, createdBy: 'user' },
      }

      const parts = buildArgsParts(stmt)
      const outputKeys = extractKeys(parts)

      // schema 声明的字段中，有哪些没出现在 codegen 输出里（排除已知未实现字段）
      const missing = [...schemaFields].filter((f) => {
        if (KNOWN_CODEGEN_PENDING.has(`${op}:${f}`)) return false
        return !outputKeys.has(f)
      })
      if (missing.length > 0) {
        mismatches.push(`${op}: schema fields not in codegen output: ${missing.join(', ')}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('codegen 输出的 key 都在 schema 字段中声明（无多余 key）', () => {
    const mismatches: string[] = []
    for (const op of SCHEMA_OPS) {
      if (OPS_TO_SKIP.has(op)) continue

      const schema = getOpSchema(op)
      if (!schema) continue

      const schemaFields = new Set(schema.fields.map((f) => f.name))
      const args = NON_DEFAULT_ARGS[op]
      if (!args) continue

      const stmt: CadStatement = {
        id: 'st_test',
        op,
        args: args as never,
        inputs: [],
        feature: { kind: 'primitive', label: op, createdBy: 'user' },
      }

      const parts = buildArgsParts(stmt)
      const outputKeys = extractKeys(parts)

      // codegen 输出的字段中，有哪些没在 schema 里声明
      const extra = [...outputKeys].filter((k) => !schemaFields.has(k))
      if (extra.length > 0) {
        mismatches.push(`${op}: codegen output keys not in schema: ${extra.join(', ')}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})
