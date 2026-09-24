/**
 * @vitest-environment node
 *
 * engine-switch-p2 — Phase 2 验收（方案 §Phase 2 #6）
 *
 * 1. parity：occt 与 brepkit 双引擎下 linearPattern / circularPattern 输出一致
 *    （BrepEngineApi 层：同一输入 → 同一内核方法 → volume/份数一致）；
 * 2. 静态判定：brepkit 下未实现能力（chamfer——无 chamfer/chamferDistAngle 且
 *    chamferWithHistory 未导出）→ 执行前明确报错（含引擎 id + 缺失能力名），
 *    不落入"静默通过判定后死在运行时"；
 * 3. 装配期完整性：KernelAdapter 缺胶水方法（createVector3d 等）→ 装配期报错。
 *
 * Run: npx vitest run src/brep/engine/engine-switch-p2.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  __resetEngineRegistriesForTests,
  getBrepEngine,
} from './registry'
import { registerOcctBrepEngine } from './adapters/occt'
import { registerBrepkitBrepEngine } from './adapters/brepkit'
import type { BrepEngineApi } from './primitives'
import {
  assertGlueMethodsComplete,
  buildKernelAdapter,
} from '../../api/occt-kernel-bridge'
import { CadRuntime } from '../../cad-runtime/runtime'
import type { ExecutionResult } from '../../cad-runtime/runtime'
import { createApiNamespaceWithEditorOps } from '../../test-support/editor-ops'

let occtApi: BrepEngineApi
let brepkitApi: BrepEngineApi

/** 释放句柄（occt 需显式 release；brepkit GC 型 no-op，安全重复）。 */
function disposeAll(kernel: BrepEngineApi, handles: unknown[]): void {
  for (const h of handles) {
    try {
      kernel.release(h as never)
    } catch {
      // 已释放/无效句柄忽略
    }
  }
}

function makeRuntime(): CadRuntime {
  return new CadRuntime({ events: { emit() {} } }, 'brep', { cad: createApiNamespaceWithEditorOps() })
}

async function runBreps(code: string): Promise<ExecutionResult> {
  return makeRuntime().execute(code)
}

beforeAll(async () => {
  // occt 引擎（默认），取 BrepEngineApi
  await registerOcctBrepEngine()
  occtApi = (await getBrepEngine()).primitives

  // brepkit 引擎：重置注册表后注册（brepkit 成为默认）
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
  brepkitApi = (await getBrepEngine()).primitives

  // 恢复 occt 为默认（本文件用例按需切换；其它测试文件不受影响）
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

/** 两引擎都产一个 20³ 盒 + linearPattern 3 份 + fuse，返回 fused 体积。 */
function linearPatternVolume(kernel: BrepEngineApi): number {
  const box = kernel.makeBox(20, 20, 20)
  let fused: unknown
  const temps: unknown[] = [box]
  try {
    const copies = kernel.linearPattern(box, { x: 1, y: 0, z: 0 }, 20, 3)
    temps.push(...copies)
    fused = kernel.fuseAll(copies)
    return kernel.getVolume(fused as never)
  } finally {
    disposeAll(kernel, temps)
    if (fused !== undefined) kernel.release(fused as never)
  }
}

/**
 * 整圆环形阵列：3 份绕 Z 轴均分（brepkit 无 center/angle，固定整圆 360/count）。
 * ⚠️ 盒必须先平移到旋转半径外（center 在原点时副本原地旋转、完全重叠 →
 * brepkit cluster fuse 退化为 mesh fallback，parity 无法比较）。
 */
function circularPatternVolume(kernel: BrepEngineApi): number {
  const base = kernel.makeBox(10, 10, 10)
  const box = kernel.translate(base, 40, 0, 0)
  let fused: unknown
  const temps: unknown[] = [base, box]
  try {
    const copies = kernel.circularPattern(
      box,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      120,
      3,
    )
    temps.push(...copies)
    fused = kernel.fuseAll(copies)
    return kernel.getVolume(fused as never)
  } finally {
    disposeAll(kernel, temps)
    if (fused !== undefined) kernel.release(fused as never)
  }
}

describe('Phase 2 parity：occt 与 brepkit 的 pattern 输出一致', () => {
  it('linearPattern：体积一致（1% 容差）+ 份数一致', () => {
    const occtV = linearPatternVolume(occtApi)
    const brepkitV = linearPatternVolume(brepkitApi)
    expect(Math.abs(occtV - brepkitV) / occtV).toBeLessThan(0.01)

    const occtBox = occtApi.makeBox(20, 20, 20)
    const bkBox = brepkitApi.makeBox(20, 20, 20)
    const occtCopies = occtApi.linearPattern(occtBox, { x: 1, y: 0, z: 0 }, 20, 4)
    const bkCopies = brepkitApi.linearPattern(bkBox, { x: 1, y: 0, z: 0 }, 20, 4)
    expect(occtCopies.length).toBe(4)
    expect(bkCopies.length).toBe(4)
    disposeAll(occtApi, [occtBox, ...occtCopies])
    disposeAll(brepkitApi, [bkBox, ...bkCopies])
  })

  it('circularPattern（整圆）：体积一致（1% 容差）+ 份数一致', () => {
    const occtV = circularPatternVolume(occtApi)
    const brepkitV = circularPatternVolume(brepkitApi)
    expect(Math.abs(occtV - brepkitV) / occtV).toBeLessThan(0.01)

    const occtBase = occtApi.makeBox(10, 10, 10)
    const bkBase = brepkitApi.makeBox(10, 10, 10)
    const occtBox = occtApi.translate(occtBase, 40, 0, 0)
    const bkBox = brepkitApi.translate(bkBase, 40, 0, 0)
    const occtCopies = occtApi.circularPattern(
      occtBox, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 120, 3,
    )
    const bkCopies = brepkitApi.circularPattern(
      bkBox, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 120, 3,
    )
    expect(occtCopies.length).toBe(3)
    expect(bkCopies.length).toBe(3)
    disposeAll(occtApi, [occtBase, occtBox, ...occtCopies])
    disposeAll(brepkitApi, [bkBase, bkBox, ...bkCopies])
  })
})

describe('Phase 2 静态判定：brepkit 下缺能力 op 执行前明确报错', () => {
  it('chamfer：平台 op（engines occt）在 brepkit 下执行前报 E_BREP_UNSUPPORTED，含引擎 id 与当前引擎（Phase 5 D11-4）', async () => {
    // brepkit 为默认引擎（mode 'brep' 强制 BREP 链）
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const result = await runBreps(
      'const s0 = cad.box(20, 20, 20, { centered: true })\n' +
        'const s1 = cad.chamfer(s0, { edges: [], type: "equal", width: 1 })',
    )
    expect(result.failedAt).toBeDefined()
    const msg = JSON.stringify(result.failedAt)
    // 平台归属前置判定（D11-4 报错形态）：op 名 + 要求引擎 + 当前引擎必须出现。
    // Phase 4 起 chamfer 不再有 capabilities（declared eng ines ['occt']），报错不列能力名。
    expect(msg).toMatch(/chamfer/)
    expect(msg).toMatch(/op requires engine occt/)
    expect(msg).toMatch(/brepkit/)
  })
})

describe('Phase 2 装配期完整性：KernelAdapter 缺胶水方法 → 装配期报错', () => {
  it('occt 适配器：胶水方法齐备，完整性通过', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const engine = await getBrepEngine()
    const adapter = buildKernelAdapter(engine)
    expect(() => assertGlueMethodsComplete(engine.id, adapter)).not.toThrow()
  })

  it('brepkit 适配器：胶水方法由 wrapBrepEngineApi 合成 → 完整性通过（2026-09-23 收敛方案后）', async () => {
    // 旧行为（brepkit 缺胶水方法 → 装配期拒绝注入）已被修复：胶水方法是 vendored
    // 调用约定（纯数据构造，零内核调用），由包装层 wrapBrepEngineApi 为任何引擎
    // 合成——见 docs/plans/2026-09-23-vendored-measurement-surface-engine-convergence.md §3.1。
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const engine = await getBrepEngine()
    const adapter = buildKernelAdapter(engine)
    expect(() => assertGlueMethodsComplete(engine.id, adapter)).not.toThrow()
    // 合成形态抽验：6 个胶水方法齐备且 axis1 字段名符合 vendored 约定。
    const a = adapter as unknown as Record<string, unknown>
    const vec = (a.createVector3d as (x: number, y: number, z: number) => { __type: string; delete: () => void })(1, 2, 3)
    expect(vec.__type).toBe('vector3d')
    expect(typeof vec.delete).toBe('function')
    const ax1 = (a.createAxis1 as (...args: number[]) => { origin: unknown; direction: unknown; __type: string })(0, 0, 0, 0, 0, 1)
    expect(ax1.__type).toBe('axis1')
    expect(ax1.origin).toEqual({ x: 0, y: 0, z: 0 })
    expect(ax1.direction).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('自建缺胶水引擎：完整性检查直接对裸适配器抛错（防线保留，防未来新引擎漏合成）', () => {
    // buildKernelAdapter 现在会为任何 BrepEngineApi 合成胶水方法，检查器对合成后
    // 的适配器自然通过；检查本身保留为防线——对真正缺失的裸适配器（如手工构造
    // 的 KernelAdapter）仍在装配期报错。
    const bare = { id: 'bare', volume: () => 0 } as unknown as Parameters<typeof assertGlueMethodsComplete>[1]
    expect(() => assertGlueMethodsComplete('bare', bare)).toThrow(
      /cannot back the vendored compat surface/,
    )
  })
})
