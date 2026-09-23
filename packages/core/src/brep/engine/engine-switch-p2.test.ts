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
  type BrepEngine,
} from './registry'
import { registerOcctBrepEngine } from './adapters/occt'
import { registerBrepkitBrepEngine } from './adapters/brepkit'
import type { BrepEngineApi } from './primitives'
import {
  assertGlueMethodsComplete,
  buildKernelAdapter,
} from '../../api/occt-kernel-bridge'
import { CadRuntime } from '../../cad-runtime/runtime'
import { createApiNamespace } from '../../api/api-namespace'
import type { ExecutionResult } from '../../cad-runtime/runtime'

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
  return new CadRuntime({ events: { emit() {} } }, 'brep', { cad: createApiNamespace() })
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
  it('chamfer：brepkit 无 chamfer/chamferDistAngle → E_BREP_UNSUPPORTED 含引擎 id 与缺失能力名', async () => {
    // brepkit 为默认引擎（mode 'brep' 强制 BREP 链）
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const result = await runBreps(
      'const s0 = cad.box(20, 20, 20, { centered: true })\n' +
        'const s1 = cad.chamfer(s0, { edges: [], type: "equal", width: 1 })',
    )
    expect(result.failedAt).toBeDefined()
    const msg = JSON.stringify(result.failedAt)
    // 能力前置判定：缺失能力名 + 引擎 id 必须出现在报错里（方案 §5.2 报错形态）
    expect(msg).toMatch(/chamfer/)
    expect(msg).toMatch(/lacks capability/)
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

  it('brepkit 适配器：缺 createVector3d 等胶水方法 → 装配期报错（明确，非执行期崩）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const engine = await getBrepEngine()
    const adapter = buildKernelAdapter(engine)
    expect(() => assertGlueMethodsComplete(engine.id, adapter)).toThrow(
      /missing glue method.*createVector3d/,
    )
  })

  it('自建缺胶水引擎：注入前完整性检查抛错', () => {
    const bare: BrepEngine = {
      id: 'bare',
      primitives: {} as unknown as BrepEngineApi,
    }
    const adapter = buildKernelAdapter(bare)
    expect(() => assertGlueMethodsComplete(bare.id, adapter)).toThrow(
      /cannot back the vendored compat surface/,
    )
  })
})
