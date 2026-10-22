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

import { collectSkillDocData, generateApiReference } from '../../../../scripts/gen-skill-docs'
import { createApiNamespace } from '../../../../packages/core/src/api/api-namespace'

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

  it('完备性：cad 命名空间内所有应渲染的 op 都必须以 "### `name(...)`" 条目出现在参考中（防整段被守卫静默丢弃）', () => {
    // 2026-10-22 回归：script-face 段守卫找 '####' 而 renderOpEntry 输出 '###'，
    // 导致 "Generated Script-Face Ops" 整段（含 linearPattern 等全部阵列 op）
    // 被静默丢弃。此测试不针对特定 op 名，而是锁住不变式本身：
    // 运行时命名空间 ∩ engine buckets 中凡 bucket 允许渲染的 op，
    // 手册里必须存在它的条目标题；新加 op 忘写文档也会在此报错。
    const data = collectSkillDocData()
    const ns: Record<string, unknown> = createApiNamespace()
    const namespaceKeys = new Set(
      Object.keys(ns).filter(k => k !== 'contractVersion' && typeof ns[k] === 'function'),
    )
    const keep = (bucket: string, target: 'occt' | 'brepkit'): boolean =>
      bucket === 'common' ||
      (target === 'occt' && bucket === 'occt-only') ||
      (target === 'brepkit' && bucket === 'brepkit-only')

    for (const target of ['occt', 'brepkit'] as const) {
      const doc = generateApiReference(target)
      const missing: string[] = []
      for (const [name, bucket] of data.buckets) {
        if (!namespaceKeys.has(name)) continue
        if (!data.opDocs.has(name)) continue // 无 JSDoc 的 op 由 --print 的 WARNING 口径另行跟踪
        if (!keep(bucket, target)) continue
        if (!doc.includes(`### \`${name}(`)) missing.push(name)
      }
      expect(missing, `${target} 参考缺失文档条目的 op`).toEqual([])
    }
  })

  it('script-face ops（阵列等生成 op）必须在两份参考中都有文档条目', () => {
    // 阵列 op 全部走 SCRIPT_FACE_OPS 通道，历史上正是这一通道被整段丢弃；
    // 保留具名断言作为最小可读锚点。
    for (const name of ['linearPattern', 'circularPattern', 'gridPattern', 'rectangularPattern', 'mirrorJoin']) {
      expect(generateApiReference('occt')).toContain(`### \`${name}(`)
      expect(generateApiReference('brepkit')).toContain(`### \`${name}(`)
    }
  })

  it('无内部文档引用（§/设计条目号/裁决/Phase/方案日期），且不误伤合法内容', () => {
    // 2026-10-22：手册的读者是上游模型，拿不到 faijs 内部规格文档，
    // "§4.1"、"D8 R2"、"裁决 3"、"Phase 3 L3"、"P0 §5.0"、"方案 2026-10-01" 一律是噪音。
    const internalRefPatterns: Array<[RegExp, string]> = [
      [/§\d/, '§ 章节引用'],
      [/裁决\s*\d/, '裁决编号'],
      [/\b[ABC]\s*决策\b/, '决策标签'],
      [/Phase\s*\d/, 'Phase 编号'],
      [/(?<![A-Za-z0-9_])D\d{1,3}(?:\.\d+)?(?:\s+R\d{1,3})?(?!\d)/, '设计条目号（D8 R2 / D11）'],
      [/(?<![A-Za-z0-9_])L\d+(?!\d)/, '层号（L1/L3）'],
      [/\d{4}-\d{2}-\d{2}/, '方案日期'],
      [/P\d\s*§/, 'P0 § 组合引用'],
    ]
    for (const target of ['occt', 'brepkit'] as const) {
      const doc = generateApiReference(target)
      for (const [re, label] of internalRefPatterns) {
        expect(re.test(doc), `${target} 参考含内部引用（${label}）`).toBe(false)
      }
      // 负向保护：清洗器不得误伤合法内容
      expect(doc).toContain('ASTM D2911')
      expect(doc).toContain('R2000')
      expect(doc).toContain('R12')
    }
  })
})
