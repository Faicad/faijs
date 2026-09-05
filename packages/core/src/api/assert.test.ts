/**
 * stdlib assert — per-op 参数自校验测试（Phase 2.2）
 *
 * Run: npx vitest run src/stdlib/assert.test.ts
 */

import { describe, it, expect } from 'vitest'
import { assertBoxParams, assertSphereParams, assertCylinderParams, assertConeParams, assertWedgeParams } from './primitives'
import { assertDrillParams } from './fai_drill'
import { assertExtrudeParams } from './fai_extrude'
import { assertEngraveParams } from './engrave'
import { assertTranslateParams, assertRotateParams, assertScaleParams } from './transform'
import { assertSdfParams } from './sdf'
import { assertTextParams } from './text'
import { assertScrewParams } from './screw'
import { assertSvgExtrudeParams } from './svgExtrude'
import { assertKnurlParams } from './knurl'
import { assertNonZeroVec3 } from './assert'

describe('stdlib per-op assert: 创建类', () => {
  it('box: width/depth/height 必填 > 0；旧 { size } 抛 E_ARGS_FORM（§4.1）', () => {
    expect(() => assertBoxParams({})).toThrow(/box\.width/)
    expect(() => assertBoxParams({ width: 1, depth: 2 })).toThrow(/box\.height/)
    expect(() => assertBoxParams({ width: 0, depth: 2, height: 3 })).toThrow(/box\.width/)
    expect(() => assertBoxParams({ size: 20 })).toThrow(/E_ARGS_FORM.*box\(width, depth, height/)
    expect(() => assertBoxParams({ size: [1, 2, 3] })).toThrow(/E_ARGS_FORM/)
    expect(() => assertBoxParams({ width: 1, depth: 2, height: 3 })).not.toThrow()
    expect(() =>
      assertBoxParams({ width: 1, depth: 2, height: 3, centered: true, at: [0, 0, 0], segments: 32 }),
    ).not.toThrow()
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

  it('rotate_euler: anglesDeg 必填 vec3；pivot（如有）为 vec3', () => {
    expect(() => assertRotateParams({})).toThrow(/rotate_euler\.anglesDeg/)
    expect(() => assertRotateParams({ anglesDeg: [0, 0, 90], pivot: 'x' })).toThrow(/rotate_euler\.pivot/)
    expect(() => assertRotateParams({ anglesDeg: [0, 0, 90] })).not.toThrow()
  })

  it('scale3d: factor 必填（number > 0 或 vec3）', () => {
    expect(() => assertScaleParams({})).toThrow(/scale3d\.factor/)
    expect(() => assertScaleParams({ factor: 0 })).toThrow(/scale3d\.factor/)
    expect(() => assertScaleParams({ factor: 2 })).not.toThrow()
    expect(() => assertScaleParams({ factor: [1, 2, 3] })).not.toThrow()
  })
})

describe('stdlib per-op assert: 阶段 4 补入的校验（§6.3）', () => {
  it('assertNonZeroVec3: 零向量报错', () => {
    expect(() => assertNonZeroVec3([0, 0, 0], 'split.normal')).toThrow(/non-zero/)
    expect(() => assertNonZeroVec3([0, 0, 1], 'split.normal')).not.toThrow()
  })

  it('sdf: code 必填非空字符串', () => {
    expect(() => assertSdfParams({})).toThrow(/sdf.*code/)
    expect(() => assertSdfParams({ code: '' })).toThrow(/sdf.*code/)
    expect(() => assertSdfParams({ code: 'fn' })).not.toThrow()
  })

  it('text: text 非空；size/depth > 0', () => {
    expect(() => assertTextParams({})).toThrow(/text.*text/)
    expect(() => assertTextParams({ text: 'A', size: 0, depth: 2 })).toThrow(/text\.size/)
    expect(() => assertTextParams({ text: 'A', size: 10, depth: -1 })).toThrow(/text\.depth/)
    expect(() => assertTextParams({ text: 'A', size: 10, depth: 2 })).not.toThrow()
  })

  it('screw: system/specIdx/length 必填', () => {
    expect(() => assertScrewParams({})).toThrow(/screw/)
    expect(() => assertScrewParams({ system: 'metric', specIdx: 0, length: 10 })).not.toThrow()
  })

  it('svgExtrude: svg 必填；depth > 0', () => {
    expect(() => assertSvgExtrudeParams({})).toThrow(/svgExtrude.*svg/)
    expect(() => assertSvgExtrudeParams({ svg: '<svg/>', depth: 0 })).toThrow(/svgExtrude\.depth/)
    expect(() => assertSvgExtrudeParams({ svg: '<svg/>', depth: 5 })).not.toThrow()
  })

  it('knurl: knurlTextureHeight 必填 > 0', () => {
    expect(() => assertKnurlParams({})).toThrow(/knurl/)
    expect(() => assertKnurlParams({ knurlTextureHeight: 0 })).toThrow(/knurl/)
    expect(() => assertKnurlParams({ knurlTextureHeight: 0.5 })).not.toThrow()
  })
})
