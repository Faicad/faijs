/**
 * P-0 regression: occt-wasm resolution must be linker/cwd agnostic.
 *
 * 旧实现（occtKernel.ts:75）用 4 层 `..` 猜测 node_modules 路径，失败后靠
 * `process.cwd()` 兜底——只在本仓库根跑测试时侥幸可用。monorepo 化后 cwd
 * 可能是仓库根 / packages/core / packages/tests 中的任意一个，兜底必失效。
 *
 * 核心断言：resolveOcctWasmPath() 基于 createRequire(import.meta.url)（模块
 * 位置解析），与 cwd 无关——chdir 到任意目录后路径不变且文件存在。
 * initOcctWasm() 的完整初始化在同进程跑一次（环境级单例，只初始化一次）。
 *
 * Run: npx vitest run src/occt-kernel/occtKernel.cwd.test.ts
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initOcctWasm, resolveOcctWasmPath } from './occtKernel'

describe('P-0: occt-wasm resolution is cwd-independent', () => {
  it('resolveOcctWasmPath resolves an existing file', () => {
    const p = resolveOcctWasmPath()
    expect(p).toMatch(/occt-wasm[\\/]dist[\\/]occt-wasm\.wasm$/)
    expect(existsSync(p)).toBe(true)
  })

  it.each([
    ['temp dir A', join(mkdtempSync(join(tmpdir(), 'faijs-cwd-')), 'nested', 'deeper')],
    ['temp dir B', mkdtempSync(join(tmpdir(), 'faijs-cwd-'))],
  ])('%s: resolveOcctWasmPath unchanged after chdir', (_label, cwd) => {
    const before = resolveOcctWasmPath()
    const prev = process.cwd()
    try {
      mkdirSync(cwd, { recursive: true })
      process.chdir(cwd)
      const after = resolveOcctWasmPath()
      expect(after).toBe(before)
      expect(existsSync(after)).toBe(true)
    } finally {
      process.chdir(prev)
    }
  })

  it('initOcctWasm fully initializes', async () => {
    const kernel = await initOcctWasm()
    expect(kernel).toBeDefined()
  }, 120_000)
})
