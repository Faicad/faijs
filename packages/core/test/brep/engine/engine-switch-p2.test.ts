/**
 * @vitest-environment node
 *
 * engine-switch-p2 — Phase 2 验收（方案 §Phase 2 #6）
 *
 * 1. parity：occt 与 brepkit 双引擎下 linearPattern / circularPattern 输出一致
 *    （BrepEngineApi 层：同一输入 → 同一内核方法 → volume/份数一致）；
 * 2. 静态判定：brepkit 下未实现能力（chamfer——无 chamfer/chamferDistAngle 且
 *    chamferWithHistory 未导出）→ 执行前明确报错（含引擎 id + 缺失能力名），
 *    不落入"静默通过判定后死在运行时"。
 *
 * （2026-09-25 core-decouple Phase 2：原「装配期完整性」用例随 occt-kernel-bridge
 * 删除——core 不再注入外部 registry，KernelAdapter 胶水方法检查随之失效。）
 *
 * Run: npx vitest run src/brep/engine/engine-switch-p2.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  __resetEngineRegistriesForTests,
  getBrepEngine,
} from '../../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'

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
  it('reverseShape：平台 op（engines occt）在 brepkit 下执行前报 E_BREP_UNSUPPORTED，含引擎 id 与当前引擎（Phase 5 D11-4）', async () => {
    // brepkit 为默认引擎（mode 'brep' 强制 BREP 链）
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const result = await runBreps('const s0 = cad.box(20, 20, 20)\nconst s1 = cad.reverseShape(s0)')
    expect(result.failedAt).toBeDefined()
    const msg = JSON.stringify(result.failedAt)
    // 平台归属前置判定（D11-4 报错形态）：op 名 + 要求引擎 + 当前引擎必须出现。
    // 注意：chamfer 已于 2026-09-26 B 批降级中立化（不再声明 engines:['occt']，
    // brepkit 走裸 kernel.chamfer 降级），故本用例改用仍为平台 op 的 reverseShape
    // 验证静态门（feature-family.test.ts 已覆盖 draft/thicken 同形态断言）。
    expect(msg).toMatch(/reverseShape/)
    expect(msg).toMatch(/op requires engine occt/)
    expect(msg).toMatch(/brepkit/)
  })
})
