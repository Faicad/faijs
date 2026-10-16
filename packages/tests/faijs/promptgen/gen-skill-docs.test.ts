/**
 * gen-skill-docs.test.ts
 *
 * 锁定 `scripts/gen-skill-docs.ts` 生成的 API 手册输出不变式（提示词原始材料）。
 * 这些不变式替代了已删除的 `skills/*.md` 文件与 `gen-skill-docs --check`：
 * 手册不再落盘进开源仓库，但「生成出来的内容满足消费方（ai-gateway）的守卫
 * 与章节完整性」必须由测试持续保证。
 *
 * 覆盖：
 *   1. 两份手册（brepkit / occt）均含必需章节：概述/单位制、cad.sketch、
 *      Editor 扩展 ops、Shape 实例方法（含 setColor）、@faicad/sheetmetal 库。
 *   2. bucket 过滤：brepkit 手册不含 `[OCCT only]` op，occt 手册不含 `[brepkit only]` op。
 *   3. 内容守卫：无 `{{`；无 `cad.edgeRef(` / `cad.faceRef(` 调用形态。
 *   4. 标题标记：前 200 字符含 `(brepkit engine skill)` / `(OCCT engine skill)`
 *      （ai-gateway sync 的 KERNEL_HEADING_MARKER 守卫依赖）。
 *   5. 确定性：同一次调用输出逐字节稳定。
 */
import { describe, expect, it } from 'vitest'

import { generateApiManual } from '../../../../scripts/gen-skill-docs'

describe('generateApiManual', () => {
  it('brepkit 手册含必需章节（概述/单位制、sketch、editor ops、外观 API、sheetmetal 库）', () => {
    const doc = generateApiManual('brepkit')
    expect(doc).toContain('## What is faijs?')
    expect(doc).toContain('### Unit System')
    expect(doc).toContain('## Sketch')
    expect(doc).toContain('## Editor Extension Ops')
    expect(doc).toContain('## Shape Instance Methods')
    expect(doc).toContain('setColor')
    expect(doc).toContain('@faicad/sheetmetal — Sheet-Metal CAD Domain')
  })

  it('occt 手册含必需章节（概述/单位制、sketch、editor ops、外观 API、sheetmetal 库）', () => {
    const doc = generateApiManual('occt')
    expect(doc).toContain('## What is faijs?')
    expect(doc).toContain('### Unit System')
    expect(doc).toContain('## Sketch')
    expect(doc).toContain('## Editor Extension Ops')
    expect(doc).toContain('## Shape Instance Methods')
    expect(doc).toContain('setColor')
    expect(doc).toContain('@faicad/sheetmetal — Sheet-Metal CAD Domain')
  })

  it('bucket 过滤：brepkit 手册不含 [OCCT only] op，occt 手册不含 [brepkit only] op', () => {
    const brepkit = generateApiManual('brepkit')
    const occt = generateApiManual('occt')
    expect(brepkit).not.toContain('`[OCCT only]`')
    expect(occt).not.toContain('`[brepkit only]`')
  })

  it('内容守卫：无 {{ 占位符，无 cad.edgeRef( / cad.faceRef( 调用形态', () => {
    const brepkit = generateApiManual('brepkit')
    const occt = generateApiManual('occt')
    for (const doc of [brepkit, occt]) {
      expect(doc).not.toContain('{{')
      expect(doc).not.toContain('cad.edgeRef(')
      expect(doc).not.toContain('cad.faceRef(')
    }
  })

  it('标题标记：前 200 字符含 (brepkit engine skill) / (OCCT engine skill)（sync 守卫依赖）', () => {
    const brepkit = generateApiManual('brepkit')
    const occt = generateApiManual('occt')
    expect(brepkit.slice(0, 200)).toContain('(brepkit engine skill)')
    expect(occt.slice(0, 200)).toContain('(OCCT engine skill)')
  })

  it('确定性：同一次调用输出逐字节稳定', () => {
    const a = generateApiManual('brepkit')
    const b = generateApiManual('brepkit')
    expect(a).toBe(b)
  })
})
