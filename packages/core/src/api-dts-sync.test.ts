/**
 * api.d.ts 同步守卫（Phase 2.7）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §2.7
 *
 * 校验 src/mesh/api.d.ts（生成文件）与 stdlib schemas 表保持同步。
 * 改 schema 后必须重跑 `npx tsx scripts/gen-api-dts.ts`，否则本测试失败。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { generate, outputPath } from '../scripts/gen-api-dts'

describe('api.d.ts sync guard', () => {
  it('api.d.ts is in sync with the stdlib schemas', () => {
    const generated = generate()
    const current = readFileSync(outputPath, 'utf-8')
    expect(generated).toBe(current)
  })
})
