/**
 * gen-skill-docs.test.ts
 *
 * 锁定 `scripts/gen-skill-docs.ts` 生成的纯 API 参考输出不变式（提示词原始材料）。
 * 这些不变式替代了已删除的 `skills/*.md` 文件与 `gen-skill-docs --check`：
 * 手册不再落盘进开源仓库，但「生成出来的内容满足消费方（ai-gateway）的守卫
 * 与章节完整性」必须由测试持续保证。
 *
 * 注意：总体性介绍（What is faijs / Script Structure / Key Concepts / Unit System /
 * Available Libraries）已移至 ai-gateway 的 `prompts/partials/faijs-overview.md`，
 * 不再由本生成器产出，故不再在此断言。
 *
 * 覆盖：
 *   1. 两份参考（brepkit / occt）均含必需章节：cad.sketch、Editor 扩展 ops、
 *      Shape 实例方法（含 setColor）、@faicad/sheetmetal 库。
 *   2. bucket 过滤：brepkit 参考不含 `[OCCT only]` op，occt 参考不含 `[brepkit only]` op。
 *   3. 内容守卫：无 `{{`；无 `cad.edgeRef(` / `cad.faceRef(` 调用形态。
 *   4. BANNER 标记：含 `the runtime BREP engine is **brepkit**` / `**occt**`
 *      （ai-gateway sync 的 KERNEL_BANNER_MARKER 守卫依赖，防拷反）。
 *   5. 确定性：同一次调用输出逐字节稳定。
 */
import { describe, expect, it } from 'vitest'

import { generateApiReference } from '../../../../scripts/gen-skill-docs'

describe('generateApiReference', () => {
  it('brepkit 参考含必需章节（sketch、editor ops、外观 API、sheetmetal 库）', () => {
    const doc = generateApiReference('brepkit')
    expect(doc).toContain('## Sketch')
    expect(doc).toContain('## Editor Extension Ops')
    expect(doc).toContain('## Shape Instance Methods')
    expect(doc).toContain('setColor')
    expect(doc).toContain('@faicad/sheetmetal — Sheet-Metal CAD Domain')
  })

  it('occt 参考含必需章节（sketch、editor ops、外观 API、sheetmetal 库）', () => {
    const doc = generateApiReference('occt')
    expect(doc).toContain('## Sketch')
    expect(doc).toContain('## Editor Extension Ops')
    expect(doc).toContain('## Shape Instance Methods')
    expect(doc).toContain('setColor')
    expect(doc).toContain('@faicad/sheetmetal — Sheet-Metal CAD Domain')
  })

  it('bucket 过滤：brepkit 参考不含 [OCCT only] op，occt 参考不含 [brepkit only] op', () => {
    const brepkit = generateApiReference('brepkit')
    const occt = generateApiReference('occt')
    expect(brepkit).not.toContain('`[OCCT only]`')
    expect(occt).not.toContain('`[brepkit only]`')
  })

  it('内容守卫：无 {{ 占位符，无 cad.edgeRef( / cad.faceRef( 调用形态', () => {
    const brepkit = generateApiReference('brepkit')
    const occt = generateApiReference('occt')
    for (const doc of [brepkit, occt]) {
      expect(doc).not.toContain('{{')
      expect(doc).not.toContain('cad.edgeRef(')
      expect(doc).not.toContain('cad.faceRef(')
    }
  })

  it('BANNER 标记：含 the runtime BREP engine is **brepkit** / **occt**（sync 守卫依赖）', () => {
    const brepkit = generateApiReference('brepkit')
    const occt = generateApiReference('occt')
    expect(brepkit).toContain('the runtime BREP engine is **brepkit**')
    expect(occt).toContain('the runtime BREP engine is **occt**')
  })

  it('确定性：同一次调用输出逐字节稳定', () => {
    const a = generateApiReference('brepkit')
    const b = generateApiReference('brepkit')
    expect(a).toBe(b)
  })
})
