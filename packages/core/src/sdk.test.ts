/**
 * sdk 入口测试 + 依赖守卫（F3 / roadmap V2.2）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-near-term-landing-plan.md §6.4
 *
 * - 守卫：dist/sdk.js 的静态 import 闭包不含 three / occt-wasm / manifold / node:*
 *   （SDK 零 heavy 运行时依赖的机器验证；CI 在 vitest 前已 build）。
 * - 入口：sdk 导出的构造器/守卫与主入口同源（isShape 身份表全局共享）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  solid, fromBrep, compound, isShape, isCompound, hasBrep, brepOf,
  keep, keepHidden, getBackends, configureBackends, CONTRACT_VERSION, BrepUnsupportedError,
} from './sdk'
import type { Shape } from './mesh/types'

// ── SDK 依赖守卫（dist/sdk.js 静态 import 闭包） ──

describe('sdk: 依赖守卫（dist/sdk.js 零 heavy 依赖）', () => {
  const sdkPath = fileURLToPath(new URL('../dist/sdk.js', import.meta.url))

  const hasDist = existsSync(sdkPath)
  const sdkSource = hasDist ? readFileSync(sdkPath, 'utf-8') : ''

  it.skipIf(!hasDist)('静态 import/export-from 闭包不含 three / occt-wasm / manifold / node:*', () => {
    // 收集静态说明符：`import ... from 'x'`、`import 'x'`，以及纯 re-export 形态
    // `export { ... } from 'x'`（sdk.js 是薄 re-export，主形态即 export-from）。
    const specifiers: string[] = []
    const fromRe = /(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g
    const sideRe = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
    for (const re of [fromRe, sideRe]) {
      let m: RegExpExecArray | null
      while ((m = re.exec(sdkSource)) !== null) specifiers.push(m[1])
    }

    expect(specifiers.length).toBeGreaterThan(0)
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/three/)
      expect(spec).not.toMatch(/occt-wasm/)
      expect(spec).not.toMatch(/manifold/)
      expect(spec).not.toMatch(/^node:/)
    }
    // 无动态 import（宿主经 registerLib 注入命名空间，SDK 不自行加载模块）
    expect(sdkSource).not.toMatch(/import\s*\(/)
  })
})

// ── SDK 入口使用面 ──

function cubeMesh(size: number): Shape {
  const s = size / 2
  const positions = new Float32Array([
    -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
    -s, -s, s, s, -s, s, s, s, s, -s, s, s,
  ])
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ])
  return { positions, indices }
}

describe('sdk: 构造器/守卫使用面', () => {
  it('solid → isShape；compound → isCompound', () => {
    const a = solid(cubeMesh(10))
    expect(isShape(a)).toBe(true)
    expect(isCompound(a)).toBe(false)

    const c = compound([a])
    expect(isCompound(c)).toBe(true)
    expect(isShape(c)).toBe(true)
  })

  it('fromBrep → hasBrep/brepOf 登记（句柄为 unknown，零 occt 依赖）', () => {
    const holder = { solid: { fakeHandle: 1 }, faceEvolution: new Map<number, number[]>() }
    const s = fromBrep(cubeMesh(5), holder)
    expect(isShape(s)).toBe(true)
    expect(hasBrep(s)).toBe(true)
    expect(brepOf(s)).toBe(holder.solid)
    expect(hasBrep(solid(cubeMesh(3)))).toBe(false)
  })

  it('keep/keepHidden 可调用（未装配 sink 时静默无副作用）', () => {
    const s = solid(cubeMesh(4))
    expect(() => keep(s)).not.toThrow()
    expect(() => keepHidden(s)).not.toThrow()
  })

  it('契约常量与错误类型导出', () => {
    expect(typeof CONTRACT_VERSION).toBe('number')
    const err = new BrepUnsupportedError('brep not supported')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('BrepUnsupportedError')
    expect(typeof getBackends).toBe('function')
    expect(typeof configureBackends).toBe('function')
  })
})
