/**
 * ops/assert — per-op parameter self-check for the migrated ops (A / B group).
 *
 * Ported from `packages/core/src/api/assert.test.ts` when the ops moved here
 * (`fai_drill` / `fai_extrude` / `text` / `svgExtrude` assertions travel with
 * their op). The platform assertions stay in core.
 *
 * Run: npx vitest run src/ops/assert.test.ts
 */

import { describe, it, expect } from 'vitest'
import { assertDrillParams } from './fai_drill'
import { assertExtrudeParams } from './fai_extrude'
import { assertTextParams } from './text'
import { assertSvgExtrudeParams } from './svg-extrude'

describe('editor-ops per-op assert: 特征类', () => {
  it('drill: diameter 必填 > 0；position 为 vec3；depth 为数字（<=0 表示通孔）', () => {
    expect(() => assertDrillParams({})).toThrow(/drill\.diameter/)
    expect(() => assertDrillParams({ diameter: 0 })).toThrow(/drill\.diameter/)
    expect(() => assertDrillParams({ diameter: 6, position: [0, 0, 'x'] })).toThrow(/drill\.position/)
    expect(() => assertDrillParams({ diameter: 6, position: [0, 0, 0], depth: 0 })).not.toThrow()
    expect(() => assertDrillParams({ diameter: 6, depth: -1 })).not.toThrow()
  })

  it('extrude: length 必填 > 0', () => {
    expect(() => assertExtrudeParams({})).toThrow(/extrude\.length/)
    expect(() => assertExtrudeParams({ length: 0 })).toThrow(/extrude\.length/)
    expect(() => assertExtrudeParams({ length: 20 })).not.toThrow()
  })
})

describe('editor-ops per-op assert: 创建类（B 组）', () => {
  it('text: text 非空；size/depth > 0', () => {
    expect(() => assertTextParams({})).toThrow(/text.*text/)
    expect(() => assertTextParams({ text: 'A', size: 0, depth: 2 })).toThrow(/text\.size/)
    expect(() => assertTextParams({ text: 'A', size: 10, depth: -1 })).toThrow(/text\.depth/)
    expect(() => assertTextParams({ text: 'A', size: 10, depth: 2 })).not.toThrow()
  })

  it('svgExtrude: svg 必填；depth > 0', () => {
    expect(() => assertSvgExtrudeParams({})).toThrow(/svgExtrude.*svg/)
    expect(() => assertSvgExtrudeParams({ svg: '<svg/>', depth: 0 })).toThrow(/svgExtrude\.depth/)
    expect(() => assertSvgExtrudeParams({ svg: '<svg/>', depth: 5 })).not.toThrow()
  })
})
