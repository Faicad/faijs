/**
 * stdlib assert — per-op 参数自校验测试（Phase 2.2）
 *
 * Run: npx vitest run src/stdlib/assert.test.ts
 */

import { describe, it, expect } from 'vitest'
import { assertBoxParams, assertSphereParams, assertCylinderParams, assertConeParams, assertWedgeParams } from './primitives'
import { assertDrillParams } from './drill'
import { assertExtrudeParams } from './extrude'
import { assertEngraveParams } from './engrave'
import { assertTranslateParams, assertRotateParams, assertScaleParams } from './transform'
import { assertBooleanParams } from './boolean'

describe('stdlib per-op assert: 创建类', () => {
  it('box: size 必填（number 或 vec3）', () => {
    expect(() => assertBoxParams({})).toThrow(/box\.size/)
    expect(() => assertBoxParams({ size: 0 })).toThrow(/box\.size/)
    expect(() => assertBoxParams({ size: [1, 2, 3] })).not.toThrow()
    expect(() => assertBoxParams({ size: 20 })).not.toThrow()
  })

  it('sphere: radius 必填 > 0', () => {
    expect(() => assertSphereParams({})).toThrow(/sphere\.radius/)
    expect(() => assertSphereParams({ radius: -1 })).toThrow(/sphere\.radius/)
    expect(() => assertSphereParams({ radius: 10 })).not.toThrow()
  })

  it('cylinder: radius/height 必填 > 0', () => {
    expect(() => assertCylinderParams({ radius: 5 })).toThrow(/cylinder\.height/)
    expect(() => assertCylinderParams({ radius: 0, height: 10 })).toThrow(/cylinder\.radius/)
    expect(() => assertCylinderParams({ radius: 5, height: 10 })).not.toThrow()
  })

  it('cone: radiusBottom/height > 0，radiusTop >= 0', () => {
    expect(() => assertConeParams({ radiusTop: 0, height: 10 })).toThrow(/cone\.radiusBottom/)
    expect(() => assertConeParams({ radiusBottom: 5, radiusTop: -1, height: 10 })).toThrow(/cone\.radiusTop/)
    expect(() => assertConeParams({ radiusBottom: 5, radiusTop: 0, height: 10 })).not.toThrow()
  })

  it('wedge: width/height/angle/length 必填 > 0', () => {
    expect(() => assertWedgeParams({ width: 10, height: 10, angle: 45 })).toThrow(/wedge\.length/)
    expect(() => assertWedgeParams({ width: 10, height: 10, angle: 45, length: 20 })).not.toThrow()
  })
})

describe('stdlib per-op assert: 特征类', () => {
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

  it('engrave: 至少 text 或 svg 之一；depth > 0', () => {
    expect(() => assertEngraveParams({})).toThrow(/text.*svg/)
    expect(() => assertEngraveParams({ text: 'A', depth: -1 })).toThrow(/engrave\.depth/)
    expect(() => assertEngraveParams({ text: 'A', depth: 2 })).not.toThrow()
    expect(() => assertEngraveParams({ svg: '<svg/>' })).not.toThrow()
  })
})

describe('stdlib per-op assert: 变换类', () => {
  it('translate: offset 必填 vec3', () => {
    expect(() => assertTranslateParams({})).toThrow(/translate\.offset/)
    expect(() => assertTranslateParams({ offset: [1, 2] })).toThrow(/translate\.offset/)
    expect(() => assertTranslateParams({ offset: [1, 2, 3] })).not.toThrow()
  })

  it('rotate: anglesDeg 必填 vec3；pivot（如有）为 vec3', () => {
    expect(() => assertRotateParams({})).toThrow(/rotate\.anglesDeg/)
    expect(() => assertRotateParams({ anglesDeg: [0, 0, 90], pivot: 'x' })).toThrow(/rotate\.pivot/)
    expect(() => assertRotateParams({ anglesDeg: [0, 0, 90] })).not.toThrow()
  })

  it('scale: factor 必填（number > 0 或 vec3）', () => {
    expect(() => assertScaleParams({})).toThrow(/scale\.factor/)
    expect(() => assertScaleParams({ factor: 0 })).toThrow(/scale\.factor/)
    expect(() => assertScaleParams({ factor: 2 })).not.toThrow()
    expect(() => assertScaleParams({ factor: [1, 2, 3] })).not.toThrow()
  })
})

describe('stdlib per-op assert: 布尔', () => {
  it('boolean: operation 必填，union | subtract | intersect', () => {
    expect(() => assertBooleanParams({})).toThrow(/boolean\.operation/)
    expect(() => assertBooleanParams({ operation: 'fuse' })).toThrow(/boolean\.operation/)
    expect(() => assertBooleanParams({ operation: 'union' })).not.toThrow()
    expect(() => assertBooleanParams({ operation: 'subtract' })).not.toThrow()
  })
})
