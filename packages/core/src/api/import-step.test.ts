/**
 * import_step — 任意路径 STEP 文件导入 op 测试（方案 Phase 5 / Q2 真缺口）
 *
 * 覆盖（无需 WASM 的外层）：
 * - 无 assets resolveFile 后端 → OpError E_OP_FAILED
 * - mesh 模式（无 OCCT 内核）→ BrepUnsupportedError（brep 专属，不静默回退）
 * - path 参数非法（非字符串/空）→ OpError E_ARGS
 * - E3 链根 roleTable：imported:<i> 按枚举序命名（与 import_brep 同源机制）
 * - 真实 e2e：fixtures box_boss.step → OCCT 读入 → 体积 > 0 + STEP roundtrip
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { HostPorts } from '../cad-runtime/ports'
import {
  configureBackends,
  CONTRACT_VERSION,
  BrepUnsupportedError,
  type Backends,
} from '../runtime-state'
import { OpError } from './internal/result-unwrap'
import { import_step } from './import-step'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { asPartName } from '../identity'
import type { RoleTable } from '../topology/naming/types'
import type { StmtId } from '../identity'
import { createEditorRuntime } from '../test-support/editor-ops'

// ── 素材与 helpers ──

const STEP_BUFFER = readFileSync(
  new URL('../../../fixtures/data/box_boss.step', import.meta.url),
).buffer

function makeBackends(mode: 'auto' | 'brep' | 'mesh', kernelBrep?: unknown, assets?: unknown): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode, brepCapabilities: undefined },
    kernel: { brep: kernelBrep ?? null, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: (assets ?? undefined) as Backends['assets'],
    events: { emit: () => undefined },
  } as unknown as Backends
}

const fakeAssets = {
  resolveFile: async (_path: string): Promise<ArrayBuffer> => STEP_BUFFER,
}

// ── 契约层错误路径 ──

describe('import_step: contract errors', () => {
  it('no assets resolveFile backend → OpError E_OP_FAILED', async () => {
    configureBackends(makeBackends('auto'))
    await expect(import_step({ path: 'x.step' })).rejects.toThrow(OpError)
    await expect(import_step({ path: 'x.step' })).rejects.toThrow(/assets backend \(resolveFile\) is required/)
  })

  it('mesh mode (no OCCT kernel) → BrepUnsupportedError', async () => {
    configureBackends(makeBackends('mesh', undefined, fakeAssets))
    await expect(import_step({ path: 'x.step' })).rejects.toThrow(BrepUnsupportedError)
  })

  it('invalid path arg (non-string) → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', undefined, fakeAssets))
    await expect(import_step({ path: 123 })).rejects.toThrow(OpError)
    await expect(import_step({ path: 123 })).rejects.toThrow(/path \(string\) is required/)
  })

  it('empty path → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', undefined, fakeAssets))
    await expect(import_step({ path: '' })).rejects.toThrow(/path \(string\) is required/)
  })
})

// ── E3: chain-root roleTable ──

describe('import_step: chain-root roleTable (E3)', () => {
  it('registers a roleTable keyed by the import stmt', async () => {
    const faceHandles = [{}] as unknown[]
    const fakeKernel = {
      // loadBrep: STEP head → kernel.importStep 解析；一个 solid 子形解包
      fromBREP: () => { throw new Error('not a BREP text') },
      importStep: () => ({ h: 1 }),
      getSubShapes: (_shape: unknown, kind: string) => (kind === 'solid' ? [{}] : kind === 'face' ? faceHandles : []),
      release: () => undefined,
      subShapeHashes: (_s: unknown, kind: string) => (kind === 'face' ? [201, 202] : []),
      meshShape: () => ({ positions: [0, 0, 0], indices: [] }),
      surfaceType: () => 'plane',
      surfaceNormal: () => [0, 0, 1],
      surfaceCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
      uvBounds: () => ({ uMin: 0, uMax: 0, vMin: 0, vMax: 0 }),
      area: () => 1,
      centerOfMass: () => ({ x: 0, y: 0, z: 0 }),
    }
    configureBackends(makeBackends('brep', { ...fakeKernel }, fakeAssets))

    await import_step({ path: 'ignored.step' })
    // 1.10 前置③：roleTable 权威落点 = 血缘图旁挂（语句键 + part 键），slot 缓存字段已删。
    // 本单测无语句锚点 ⇒ 注入空串锚点（与表的 origin='' 占位一致），读语句键表。
    const { setCurrentStmt } = await import('../runtime-state')
    const { runtimeLineage } = await import('../topology/naming/lineage')
    setCurrentStmt({ id: '' as never, outputs: [] as never })
    try {
      // 重跑一次让 fromBrep 在锚点内记录（首次调用发生在注入前）
      await import_step({ path: 'ignored.step' })
    } finally {
      setCurrentStmt(undefined)
    }
    const table = runtimeLineage.outputTableOf('' as never) as RoleTable | undefined
    expect(table, 'roleTable registered on the imported shape').toBeDefined()
    const origins = [...(table?.keys() ?? [])]
    // 单测无语句锚点 → 空串 origin 占位（与 import_brep 同规则）
    expect(origins).toEqual([''])
    const roles = table?.get('' as StmtId)
    expect(roles?.size).toBe(2)
    expect(roles?.get('imported:0')).toEqual([201])
    expect(roles?.get('imported:1')).toEqual([202])
  })
})

// ── 真实 e2e：OCCT + fixtures STEP 文件 ──

describe('import_step: real STEP file e2e (occt)', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('reads a .step path via host resolveFile → solid with volume > 0', async () => {
    await registerOcctBrepEngine()
    const ports: HostPorts = {
      events: { emit: () => undefined },
      assets: {
        resolveByKey: async () => ({ bytes: STEP_BUFFER }),
        resolveFile: async () => STEP_BUFFER,
        resolveUrl: async () => STEP_BUFFER,
      },
    }
    const runtime = createEditorRuntime(ports, 'brep')
    const result = await runtime.execute(
      `let a = await cad.import_step({ path: 'fixtures/box_boss.step' })\nlet r = a`,
    )
    expect(result.failedAt).toBeUndefined()
    expect(result.brepSolids).toBeDefined()
    const entry = result.brepSolids!.get(asPartName('a'))
    expect(entry, 'import_step result lands in brepSolids').toBeDefined()
    // box_boss.step 是实体 STEP——OCCT 读入后体积应 > 0
    expect(entry!.kernel.getVolume(entry!.solid)).toBeGreaterThan(0)
    // STEP roundtrip：导出仍含精确曲面面（ADVANCED_FACE），证明是 BREP 导入而非三角化
    expect(entry!.kernel.exportStep(entry!.solid)).toContain('ADVANCED_FACE')
  })
})
