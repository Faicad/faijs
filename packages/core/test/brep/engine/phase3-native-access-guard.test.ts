/**
 * Phase 3 守卫（narrowing plan §Phase 3 验收 / §5 守卫清单）：
 * `occt-kernel/` 与 `brep/engine/` 下禁止 `as BrepEngineApi` 跨层断言。
 *
 * 背景：旧 occt 适配器用 `as unknown as BrepEngineApi` 硬断言 initOcctWasm 返回值，
 * 编译期守卫恒真空转，类型撒谎已实际造成过 pattern 返回形态 bug（linearPattern
 * 返回 compound 却被类型声称成数组）。Phase 3 起 occt 侧 L1 实现改为显式对象
 * 字面量（occt-primitives.ts），编译期 `_AssertOcctApi` 获得真校验力；本测试守住
 * 「不再回退到跨层断言」。
 *
 * 断言什么：
 * 1. 源码（非测试）里 `as BrepEngineApi` 零命中（白名单：类型定义/守卫文件）；
 * 2. `initOcctWasm()` 的返回类型就是 `OcctKernel`（原生面），不再被断言收窄。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SCAN_DIRS = [
  join(ROOT, 'src', 'occt-kernel'),
  join(ROOT, 'src', 'brep', 'engine'),
]

/** 逐字允许的文件（相对 src/）：契约定义本身与编译期守卫类型所在处。 */
const ALLOWLIST = new Set([
  'brep/engine/primitives.ts',
])

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walkTs(full)
    else if (entry.endsWith('.ts')) yield full
  }
}

describe('Phase 3 守卫：禁止 as BrepEngineApi 跨层断言', () => {
  it('occt-kernel/ 与 brep/engine/ 源码零命中（白名单外）', () => {
    const offenders: string[] = []
    for (const dir of SCAN_DIRS) {
      for (const file of walkTs(dir)) {
        const rel = file.slice(ROOT.length + 1).replaceAll('\\', '/')
        if (rel.includes('.test.ts')) continue
        if (ALLOWLIST.has(rel.slice('src/'.length))) continue
        const text = readFileSync(file, 'utf-8')
        if (text.includes('as BrepEngineApi')) offenders.push(rel)
      }
    }
    expect(offenders, `以下文件含跨层断言 as BrepEngineApi（narrowing plan §D 禁止）:\n${offenders.join('\n')}`).toEqual([])
  })

  it('initOcctWasm 返回原生 OcctKernel（未被断言收窄成契约面）', async () => {
    const text = readFileSync(join(ROOT, 'src', 'occt-kernel', 'occtKernel.ts'), 'utf-8')
    expect(text).toMatch(/export async function initOcctWasm\(\): Promise<OcctKernel>/)
    // 原生面别名必须存在（平台代码经 getOcctKernel() 访问独有能力，D3）
    expect(text).toMatch(/export const getOcctKernel = getKernel/)
  })

  it('occt L1 实现走显式字面量（createOcctPrimitives），适配器不再猴子补丁', () => {
    const prim = readFileSync(join(ROOT, 'src', 'occt-kernel', 'occt-primitives.ts'), 'utf-8')
    expect(prim).toMatch(/export async function createOcctPrimitives/)
    const adapter = readFileSync(join(ROOT, 'src', 'brep', 'engine', 'adapters', 'occt.ts'), 'utf-8')
    expect(adapter).not.toMatch(/occtApi\.\w+ =/)
    expect(adapter).not.toContain('OcctPatternRaw')
  })
})
