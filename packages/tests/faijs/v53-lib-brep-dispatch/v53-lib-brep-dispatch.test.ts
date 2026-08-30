/**
 * V5.3 — 第三方库声明实现集（defineOp），走引擎同一静态分派（与内置 op 同机制）
 *
 * 验收锚点：ecosystem-roadmap §10 V5.3（"库声明 brepImpl，走 resolvePath 静态判定
 * （与内置 op 同机制）"）与 O7（"库的 BREP 支持；V5.3 前第三方库恒 mesh 路径，
 * mode='brep' 下由 dispatchPath 抛 BrepUnsupportedError → failedAt"）。
 *
 * 契约变化（2026-08-30 defineOp 双路径契约）：`dispatchPath` 不再从
 * `@faicad/faijs-core/sdk` 导出——分派由 `defineOp` 包装器内部调用同一个引擎判定
 * （backend-dispatch.ts 单点），库作者只声明实现集。D-4 严格装配校验由
 * `assertLibConforms` 在 registerLib 时执行。
 *
 * 关键路径：第三方库作者从公开 SDK 导入 `defineOp` 声明实现集，模式/链状态
 * 由包装器按引擎静态规则自动选择——与内置 op（boolean.ts booleanImpl 等）同机制，
 * 不再被锁死在 mesh 路径。
 *
 * Run: npx vitest run faijs/v53-lib-brep-dispatch/v53-lib-brep-dispatch.test.ts
 */

import { describe, it, expect } from 'vitest'
import * as sdk from '@faicad/faijs-core/sdk'
import { configureBackends, CONTRACT_VERSION, BrepUnsupportedError, MeshUnsupportedError } from '@faicad/faijs-core/runtime-state'
import type { Backends } from '@faicad/faijs-core/runtime-state'
import { defineOp, assertLibConforms } from '@faicad/faijs-core/sdk'
import { solid, fromBrep, isShape, hasBrep } from '@faicad/faijs-core/shape'
import type { Shape } from '@faicad/faijs-core/mesh/types'

// ── 工具：fake backends（只喂 dispatchPath 需要读的 config.mode） ──

function cubeMesh(size: number): Shape {
  const s = size / 2
  return {
    positions: new Float32Array([-s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s, -s, -s, s, -s, s, s, s, s, s]),
    indices: new Uint32Array([
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
    ]),
  }
}

function setMode(mode: 'auto' | 'brep' | 'mesh'): void {
  const backends: Backends = {
    contractVersion: CONTRACT_VERSION,
    config: { mode },
    kernel: { brep: null, csg: {}, sdf: {} },
    fonts: undefined as unknown as Backends['fonts'],
    texture: undefined as unknown as Backends['texture'],
    assets: undefined as unknown as Backends['assets'],
    events: undefined as unknown as Backends['events'],
    cad: {},
  }
  configureBackends(backends)
}

// ── 测试数据：链上输入（hasBrep=true）与普通网格输入（hasBrep=false） ──
// 静态判定只读 hasBrep 标记，不需要真 OCCT 内核（零 heavy 依赖）。

const inChain = fromBrep(cubeMesh(10), { solid: { h: 1 }, faceEvolution: new Map<number, number[]>() })
const offChain = solid(cubeMesh(10))

// ── ① SDK 公开面：defineOp 是库作者的声明入口；dispatchPath 移出公开面 ──

describe('V5.3: SDK 公开面与 defineOp（第三方库声明实现集）', () => {
  it('SDK 导出 defineOp / assertLibConforms（declaration-driven，无需手写 dispatchPath）', () => {
    expect(typeof sdk.defineOp).toBe('function')
    expect(typeof sdk.assertLibConforms).toBe('function')
    // dispatchPath 已移出公开面；实现集声明与分派都经 defineOp。
    expect('dispatchPath' in sdk).toBe(false)
  })

  it('空实现集 / 非函数实现 在构建期报错（不等到执行）', () => {
    expect(() => defineOp({} as never)).toThrow(/at least one implementation/)
    expect(() => defineOp({ mesh: 42 } as never)).toThrow(/mesh must be a function/)
    expect(() => defineOp({ mesh: () => cubeMesh(10), brep: 42 } as never)).toThrow(/brep must be a function/)
  })
})

// └ ─ ② 静态矩阵：auto / brep / mesh × 实现集 × 输入在链（库作者视角） ──

describe('V5.3 静态矩阵：auto / brep / mesh × 实现集 × 输入在链', () => {
  it('auto：双路径 + 全部输入在链 → brep 路径执行', async () => {
    setMode('auto')
    const op = defineOp({
      mesh: (input: Shape) => cubeMesh(1),
      brep: (input: Shape) => fromBrep(input, { solid: { h: 2 }, faceEvolution: new Map<number, number[]>() }),
    })
    const r = (await op(inChain)) as Shape
    expect(hasBrep(r)).toBe(true)
  })

  it('auto：双路径但输入不在链 → 降级 mesh（并非回退，静态规则）', async () => {
    setMode('auto')
    const op = defineOp({ mesh: (input: Shape) => cubeMesh(1), brep: () => 1 as unknown as import('@faicad/faijs-core/brep/engine/types').BrepHandle })
    const r = (await op(offChain)) as Shape
    expect(hasBrep(r)).toBe(false)
  })

  it('auto：只声明 mesh（无 brep）→ 恒 mesh', async () => {
    setMode('auto')
    const op = defineOp({ mesh: (input: Shape) => cubeMesh(1) })
    const r = (await op(inChain)) as Shape
    expect(hasBrep(r)).toBe(false)
  })

  it('brep：双路径且全部在链 → brep 路径执行', async () => {
    setMode('brep')
    const op = defineOp({ mesh: (input: Shape) => cubeMesh(1), brep: () => fromBrep(cubeMesh(1), { solid: { h: 3 }, faceEvolution: new Map<number, number[]>() }) })
    const r = (await op(inChain)) as Shape
    expect(hasBrep(r)).toBe(true)
  })

  it('brep：只声明 mesh（无 brep）→ 抛 BrepUnsupportedError（引擎→failedAt）', async () => {
    setMode('brep')
    const op = defineOp({ mesh: (input: Shape) => cubeMesh(1) })
    await expect(op(inChain)).rejects.toThrow(BrepUnsupportedError)
  })

  it('brep：有 brep 但有输入不在链 → 抛 BrepUnsupportedError（不静默 mesh）', async () => {
    setMode('brep')
    const op = defineOp({ mesh: (input: Shape) => cubeMesh(1), brep: () => fromBrep(cubeMesh(1), { solid: { h: 3 }, faceEvolution: new Map<number, number[]>() }) })
    await expect(op(offChain)).rejects.toThrow(BrepUnsupportedError)
  })

  it('mesh：显式 mesh 模式优先——恒走 mesh，不读链状态', async () => {
    setMode('mesh')
    const op = defineOp({ mesh: (input: Shape) => cubeMesh(1), brep: () => fromBrep(cubeMesh(1), { solid: { h: 4 }, faceEvolution: new Map<number, number[]>() }) })
    const r = (await op(inChain)) as Shape
    expect(hasBrep(r)).toBe(false)
  })
})

// ── 第三方库 op 示例：库声明的 defineOp，产物自动包装（solid / fromBrep） ──

describe('V5.3: 第三方库 op 声明实现集（库作者视角）', () => {
  it('库定义双路径 op，auto 在链输入 → 走 brep（产物自动 fromBrep，链身份保留）', async () => {
    setMode('auto')
    const libOp = defineOp({
      mesh: (input: Shape) => cubeMesh(1),
      brep: (input: Shape) => input, // 库"透传"原对象：链身份保留
    })
    const r = (await libOp(inChain)) as Shape
    expect(r).toBe(inChain)
  })

  it('库只声明 mesh + brep 模式 → BrepUnsupportedError（引擎→failedAt，不静默 mesh）', async () => {
    setMode('brep')
    const libMeshOnly = defineOp({ mesh: (input: Shape) => cubeMesh(1) })
    await expect(libMeshOnly(inChain)).rejects.toThrow(BrepUnsupportedError)
  })

  it('库只声明 brep（D1b）+ auto 在链 → 走 brep；off-chain → MeshUnsupportedError（无 mesh 可降级）', async () => {
    setMode('auto')
    const libBrepOnly = defineOp({ brep: (input: Shape) => fromBrep(cubeMesh(1), { solid: { h: 5 }, faceEvolution: new Map<number, number[]>() }) })
    const r = (await libBrepOnly(inChain)) as Shape
    expect(hasBrep(r)).toBe(true)
    await expect(libBrepOnly(offChain)).rejects.toThrow(MeshUnsupportedError)
  })

  it('assertLibConforms：导出 defineOp 的库必须带匹配 contractVersion（否则 registerLib 拒绝）', () => {
    const dup = defineOp({ mesh: (input: Shape) => cubeMesh(1) })
    expect(() => assertLibConforms({ dup })).toThrow(/contractVersion/)
    expect(() => assertLibConforms({ dup, contractVersion: CONTRACT_VERSION })).not.toThrow()
  })

  it('纯函数：同一输入两三次调用结果一致（无环境副作用、无网络）', async () => {
    setMode('auto')
    const op = defineOp({ mesh: (input: Shape) => cubeMesh(1) })
    const a = await op(offChain)
    const b = await op(offChain)
    expect(isShape(a as Shape)).toBe(true)
    expect(isShape(b as Shape)).toBe(true)
    expect((a as Shape).positions.length).toBe((b as Shape).positions.length)
  })
})