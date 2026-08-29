/**
 * V5.3 — 第三方库声明 brepImpl，走 dispatchPath 静态判定（与内置 op 同机制）
 *
 * 验收锚点：ecosystem-roadmap §10 V5.3（"库声明 brepImpl，走 resolvePath 静态判定
 * （与内置 op 同机制）"）与 O7（"库的 BREP 支持；V5.3 前第三方库恒 mesh 路径，
 * mode='brep' 下由 dispatchPath 抛 BrepUnsupportedError → failedAt"）。
 *
 * 关键路径：第三方库作者从公开 SDK（src/sdk.ts）导入 dispatchPath。库函数体内
 * 用与内置 op（boolean.ts booleanImpl 等）同一判据选路径——不再被锁死在 mesh 路径。
 *
 * Run: npx vitest run test/faijs/v53-lib-brep-dispatch/v53-lib-brep-dispatch.test.ts
 */

import { describe, it, expect } from 'vitest'
import { configureBackends, CONTRACT_VERSION, BrepUnsupportedError } from '../../../src/runtime-state'
import type { Backends } from '../../../src/runtime-state'
import { dispatchPath as sdkDispatchPath } from '../../../src/sdk'
import { dispatchPath as internalDispatchPath } from '../../../src/cad-runtime/backend-dispatch'
import { solid, fromBrep } from '../../../src/stdlib/shape'
import type { Shape } from '../../../src/mesh/types'

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
    kernel: { occt: null, csg: {}, sdf: {} },
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

describe('V5.3: 第三方库声明 brepImpl（dispatchPath 静态判定，同内置机制）', () => {
  it('SDK 公开导出的 dispatchPath 与引擎内置判定是同一函数（同机制）', () => {
    expect(sdkDispatchPath).toBe(internalDispatchPath)
    expect(typeof sdkDispatchPath).toBe('function')
  })
})

describe('V5.3 静态矩阵：auto / brep / mesh × brepImpl × 输入在链', () => {
  it('auto：声明 brepImpl 且全部输入在链 → brep', () => {
    setMode('auto')
    expect(sdkDispatchPath([inChain], true)).toBe('brep')
  })

  it('auto：声明 brepImpl 但输入不在链 → mesh（降级，非回退）', () => {
    setMode('auto')
    expect(sdkDispatchPath([offChain], true)).toBe('mesh')
  })

  it('auto：未声明 brepImpl → 恒 mesh', () => {
    setMode('auto')
    expect(sdkDispatchPath([inChain], undefined)).toBe('mesh')
  })

  it('brep：声明 brepImpl 且全部输入在链 → brep', () => {
    setMode('brep')
    expect(sdkDispatchPath([inChain], { impl: true })).toBe('brep')
  })

  it('brep：未声明 brepImpl → 抛 BrepUnsupportedError', () => {
    setMode('brep')
    expect(() => sdkDispatchPath([inChain], undefined)).toThrow(BrepUnsupportedError)
  })

  it('brep：有 brepImpl 但有输入不在链 → 抛 BrepUnsupportedError（不静默 mesh）', () => {
    setMode('brep')
    expect(() => sdkDispatchPath([inChain, offChain], true)).toThrow(BrepUnsupportedError)
  })

  it('brep：空输入 + 有 brepImpl → brep（无输入无判断输入，不抛错）', () => {
    setMode('brep')
    expect(sdkDispatchPath([], true)).toBe('brep')
  })

  it('mesh：恒 mesh——即使全部在链且声明 brepImpl（显式 mesh 模式优先）', () => {
    setMode('mesh')
    expect(sdkDispatchPath([inChain], true)).toBe('mesh')
    expect(sdkDispatchPath([], undefined)).toBe('mesh')
  })
})

// ── 第三方库 op 示例：与内置 booleanImpl 同构的薄函数（库作者视角） ──

describe('V5.3: 第三方库 op 声明 brepImpl（库作者）', () => {
  it('库声明 brepImpl 且在链 → 走 brep，原对象透传（链身份保留）', () => {
    setMode('auto')
    const libOp = (inputs: Shape[]): Shape => {
      const path = sdkDispatchPath(inputs, { brepImpl: true })
      if (path === 'brep') return inputs[0]
      return solid(cubeMesh(1)) // mesh 侧：库自产新网格
    }
    expect(libOp([inChain])).toBe(inChain)
  })

  it('库未声明 brepImpl + brep 模式 → 抛 BrepUnsupportedError（引擎→failedAt）', () => {
    setMode('brep')
    const libMeshOnly = (inputs: Shape[]): Shape => {
      const path = sdkDispatchPath(inputs, undefined)
      void path
      return solid(cubeMesh(1))
    }
    expect(() => libMeshOnly([inChain])).toThrow(BrepUnsupportedError)
  })

  it('信息不匹配输入碰撞时（混合输入 + brep 模式）→ 抛错，不静默 mesh', () => {
    setMode('brep')
    expect(() => sdkDispatchPath([inChain, offChain], true)).toThrow(
      /E_BREP_UNSUPPORTED: input is not BREP/,
    )
  })

  it('纯函数：同一输入同一输出（无环境副作用、无网络）', () => {
    setMode('auto')
    const a = sdkDispatchPath([offChain], true)
    const b = sdkDispatchPath([offChain], true)
    expect(a).toBe('mesh')
    expect(b).toBe('mesh')
  })
})