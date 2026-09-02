/**
 * P7 双链整合——静态结构断言（D4/D10/D11 + §9 验收）
 *
 * 来源：docs/plans/2026-09-01-layered-api-architecture.md §D4 / §D10 / §D11 / §9
 *
 * 本套件只做「代码形态」断言（grep 级），不初始化 wasm、不跑几何：
 *  1. 砍 op-graph/replay（D11）：`kernel/manifold` 不搬 → opGraph.ts(47) /
 *     replay.ts(572) 随目录自然消失。此处用文件系统断言锁死——防止未来有人
 *     从别处带回运行时回退的变体。
 *  2. getKernel 冻结（D10）：`withKernel`（运行期切换）与三级 `init()` WASM
 *     回落均已砍，`freezeKernels`/`getKernel` 只读读取器保留。
 *  3. 边界（D8）：core 侧 import vendored 树只允许发生在 L3 `api/`
 *     （occt-kernel-bridge.ts 是唯一桥接点）——反向导入方向被 check-layer-
 *     boundaries.mjs 守卫，这里再做一次机械比对作为验收锚点。
 *
 * Run: npx vitest run faijs/p7-dual-chain
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** vendored 移植树根（packages/core/src/vendored/brepjs）。 */
const VENDORED_ROOT = fileURLToPath(new URL('../../../../packages/core/src/vendored/brepjs', import.meta.url))
/** core 源码根（packages/core/src）。 */
const CORE_SRC = fileURLToPath(new URL('../../../../packages/core/src', import.meta.url))

/** Recursively list every file under `dir`. */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    out.push(...(statSync(full).isDirectory() ? walk(full) : [full]))
  }
  return out
}

describe('P7 · 砍 op-graph/replay（D11：manifold 不搬）', () => {
  it('vendored 树无 kernel/manifold 目录', () => {
    expect(existsSync(join(VENDORED_ROOT, 'kernel', 'manifold'))).toBe(false)
  })

  it('vendored 树无 opGraph.ts / replay.ts（运行时回退变体不存在）', () => {
    const files = walk(VENDORED_ROOT)
    const forbidden = files.filter((f) => f.endsWith('opGraph.ts') || f.endsWith('replay.ts'))
    expect(forbidden).toEqual([])
  })
})

describe('P7 · getKernel 冻结（D10：无 withKernel / 无 init 回落）', () => {
  const kernelIndex = readFileSync(join(VENDORED_ROOT, 'kernel', 'index.ts'), 'utf8')

  it('kernel/index.ts 无运行期切换 withKernel（声明或调用）', () => {
    // 注释文本会提及 "withKernel 已砍"——断言必须盯代码形态，不含注释命中。
    expect(kernelIndex).not.toMatch(/\bfunction\s+withKernel\s*\(/)
    expect(kernelIndex).not.toMatch(/\bwithKernel\s*\(/)
  })

  it('kernel/index.ts 无三级 init() WASM 回落', () => {
    expect(kernelIndex).not.toMatch(/\bfunction\s+init\s*\(/)
    expect(kernelIndex).not.toMatch(/export\s*\{[^}]*\binit\b[^}]*\}/)
  })

  it('只读读取器保留：freezeKernels / getKernel / getKernelCapabilities 均在', () => {
    expect(kernelIndex).toMatch(/export function freezeKernels/)
    expect(kernelIndex).toMatch(/export function getKernel/)
    expect(kernelIndex).toMatch(/export function getKernelCapabilities/)
  })
})

describe('P7 · 边界（D8：core 侧 import vendored 只允许在 L3 api/）', () => {
  it('全部 `vendored/brepjs` import 都位于 api/（occt-kernel-bridge 是唯一桥接点）', () => {
    const apiRoot = join(CORE_SRC, 'api') + sep
    const files = walk(CORE_SRC)
    const offenders: string[] = []
    for (const f of files) {
      if (!f.endsWith('.ts') || f.endsWith('.d.ts')) continue
      const src = readFileSync(f, 'utf8')
      if (!/vendored\/brepjs/.test(src)) continue
      if (!f.startsWith(apiRoot)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})
