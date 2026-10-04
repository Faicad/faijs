/**
 * api assert — per-op 参数自校验测试（Phase 2.2）
 *
 * A 组 / B 组 op（fai_* / text / svgExtrude）的断言随 op 迁到
 * `@faicad/faijs-extra`，其测试在 `packages/faijs-extra/src/ops/assert.test.ts`。
 *
 * Run: npx vitest run src/api/assert.test.ts
 */

import { describe, it, expect } from 'vitest'
import { assertBoxParams, assertSphereParams, assertCylinderParams, assertConeParams, assertWedgeParams } from './primitives'
import { assertEngraveParams } from './engrave'
import { assertTranslateParams, assertRotateParams, assertScaleParams, assertScale3dParams } from './transform'
import { assertSdfParams } from './sdf'
import { assertScrewParams } from './screw'
import { assertKnurlParams } from './knurl'
import { assertNonZeroVec3 } from './assert'

describe('api per-op assert: 创建类', () => {
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

describe('api per-op assert: 特征类', () => {
  it('engrave: 至少 text 或 svg 之一；depth > 0', () => {
    expect(() => assertEngraveParams({})).toThrow(/text.*svg/)
    expect(() => assertEngraveParams({ text: 'A', depth: -1 })).toThrow(/engrave\.depth/)
    expect(() => assertEngraveParams({ text: 'A', depth: 2 })).not.toThrow()
    expect(() => assertEngraveParams({ svg: '<svg/>' })).not.toThrow()
  })
})

describe('api per-op assert: 变换类', () => {
  it('translate: offset 必填 vec3', () => {
    expect(() => assertTranslateParams({})).toThrow(/translate\.offset/)
    expect(() => assertTranslateParams({ offset: [1, 2] })).toThrow(/translate\.offset/)
    expect(() => assertTranslateParams({ offset: [1, 2, 3] })).not.toThrow()
  })

  it('rotate_euler: angles 必填 vec3；pivot（如有）为 vec3', () => {
    expect(() => assertRotateParams({})).toThrow(/rotate_euler\.angles/)
    expect(() => assertRotateParams({ angles: [0, 0, 90], pivot: 'x' })).toThrow(/rotate_euler\.pivot/)
    expect(() => assertRotateParams({ angles: [0, 0, 90] })).not.toThrow()
  })

  it('scale: factor 必填 number > 0；非数组 → E_ARGS_FORM 指向 scale3d（P6 §4.6）', () => {
    expect(() => assertScaleParams({})).toThrow(/scale\.factor/)
    expect(() => assertScaleParams({ factor: 0 })).toThrow(/scale\.factor/)
    expect(() => assertScaleParams({ factor: 2 })).not.toThrow()
    expect(() => assertScaleParams({ factor: [1, 2, 3] })).toThrow(/E_ARGS_FORM.*scale3d/)
  })

  it('scale3d: factor 定死 vec3；等比标量 → E_ARGS_FORM 指向 scale（P6 §4.6）', () => {
    expect(() => assertScale3dParams({})).toThrow(/scale3d\.factor/)
    expect(() => assertScale3dParams({ factor: 2 })).toThrow(/E_ARGS_FORM.*scale/)
    expect(() => assertScale3dParams({ factor: [1, 2, 3] })).not.toThrow()
  })
})

describe('api per-op assert: 阶段 4 补入的校验（§6.3）', () => {
  it('assertNonZeroVec3: 零向量报错', () => {
    expect(() => assertNonZeroVec3([0, 0, 0], 'split.normal')).toThrow(/non-zero/)
    expect(() => assertNonZeroVec3([0, 0, 1], 'split.normal')).not.toThrow()
  })

  it('sdf: code 必填非空字符串', () => {
    expect(() => assertSdfParams({})).toThrow(/sdf.*code/)
    expect(() => assertSdfParams({ code: '' })).toThrow(/sdf.*code/)
    expect(() => assertSdfParams({ code: 'fn' })).not.toThrow()
  })

  it('screw: system/specIdx/length 必填', () => {
    expect(() => assertScrewParams({})).toThrow(/screw/)
    expect(() => assertScrewParams({ system: 'metric', specIdx: 0, length: 10 })).not.toThrow()
  })

  it('knurl: knurlTextureHeight 必填 > 0', () => {
    expect(() => assertKnurlParams({})).toThrow(/knurl/)
    expect(() => assertKnurlParams({ knurlTextureHeight: 0 })).toThrow(/knurl/)
    expect(() => assertKnurlParams({ knurlTextureHeight: 0.5 })).not.toThrow()
  })
})
