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
import type { HostPorts } from '../../src/cad-runtime/ports'
import {
  configureBackends,
  CONTRACT_VERSION,
  BrepUnsupportedError,
  MeshUnsupportedError,
  type Backends,
} from '../../src/runtime-state'
import { OpError } from '../../src/api/internal/result-unwrap'
import { import_step, importStepImpl } from '../../src/api/import-step'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { asPartName } from '../../src/identity'
import type { RoleTable } from '../../src/topology/naming/types'
import type { StmtId } from '../../src/identity'
import { createEditorRuntime } from '../support/editor-ops'
import { readFileArrayBuffer } from '../../src/io/bytes-node'

// ── 素材与 helpers ──

// GOTCHA：不能用 `readFileSync(url).buffer` —— 那是 Buffer 的**底层存储**，Node 24
// 上来自共享池（文件字节在非零 byteOffset，存储比文件大）。occt-wasm 的
// importStep 会 `TextDecoder().decode(整个 ArrayBuffer)`，池残留会被当成 STEP
// 正文解析，CI(Node 24) 报 "Line 2: unexpected QUID, expecting STEP"。见 io/bytes.test.ts。
const STEP_BUFFER = readFileArrayBuffer(new URL('../../../fixtures/data/box_boss.step', import.meta.url))

function makeBackends(mode: 'auto' | 'brep' | 'mesh', kernelBrep?: unknown, assets?: unknown): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode },
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
    await expect(importStepImpl({ path: 'x.step' })).rejects.toThrow(OpError)
    await expect(importStepImpl({ path: 'x.step' })).rejects.toThrow(/assets backend \(resolveFile\) is required/)
  })

  it('mesh mode (no OCCT kernel) → BrepUnsupportedError', async () => {
    configureBackends(makeBackends('mesh', undefined, fakeAssets))
    await expect(importStepImpl({ path: 'x.step' })).rejects.toThrow(BrepUnsupportedError)
  })

  it('invalid path arg (non-string) → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', undefined, fakeAssets))
    await expect(importStepImpl({ path: 123 })).rejects.toThrow(OpError)
    await expect(importStepImpl({ path: 123 })).rejects.toThrow(/path \(string\) is required/)
  })

  it('empty path → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', undefined, fakeAssets))
    await expect(importStepImpl({ path: '' })).rejects.toThrow(/path \(string\) is required/)
  })
})

// ── L2：导出 op（defineOp 包装层）的参数覆盖 ──

// 上面的用例全部直调裸实现 `importStepImpl`（见文件头 / import-brep 的同款
// GOTCHA），因此 `path` 这个参数名从不出现在**调用点**上，而契约面覆盖门禁
// （`scripts/check-api-test-coverage.ts` 的 L2）要求每个 schema 参数在调用点被覆盖。
// 这里补一次对导出 op 的直接调用：既覆盖 `path`，也钉住「STEP 是 BREP 专属格式，
// mesh 模式下按 E_MESH_UNSUPPORTED 明确拒绝，绝不静默回退」这条静态分派事实。
describe('import_step: exported op — mesh mode refuses (E_MESH_UNSUPPORTED)', () => {
  it('cad.import_step({ path }) rejects when no mesh implementation exists', async () => {
    configureBackends(makeBackends('mesh', undefined, fakeAssets))
    await expect(import_step({ path: 'x.step' })).rejects.toThrow(MeshUnsupportedError)
    await expect(import_step({ path: 'x.step' })).rejects.toThrow(/E_MESH_UNSUPPORTED/)
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

    await importStepImpl({ path: 'ignored.step' })
    // 1.10 前置③：roleTable 权威落点 = 血缘图旁挂（语句键 + part 键），slot 缓存字段已删。
    // 本单测无语句锚点 ⇒ 注入空串锚点（与表的 origin='' 占位一致），读语句键表。
    const { setCurrentStmt } = await import('../../src/runtime-state')
    const { runtimeLineage } = await import('../../src/topology/naming/lineage')
    setCurrentStmt({ id: '' as never, outputs: [] as never })
    try {
      // 重跑一次让 fromBrep 在锚点内记录（首次调用发生在注入前）
      await importStepImpl({ path: 'ignored.step' })
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
    // 2026-09-30 GOTCHA（nameless-shape 修复，与 import-brep.test.ts 同源）：part 键
    // roleTable（outputTablesByPart）只在 defineOp 包装层的 brep 分支登记，`tableOfPart`
    // 是 place 等下游 op 的 inputRoleTable 唯一读口；裸 async 函数只落语句键表 ⇒ 下游
    // place 产物 roleTable 断流 ⇒ edgeRef 报 "no role table (nameless shape)"
    // （fcstd 语料 43 例）。本单测无 executor、part 名不存在，断言不了 part 键表本身，
    // 端到端由 fcstd-port 语料 e2e 覆盖；此处断言包装层在位。
    const { DUAL_OP_META } = await import('../../src/define-op')
    expect(
      (import_step as unknown as Record<symbol, unknown>)[DUAL_OP_META as unknown as symbol],
      'import_step must be defineOp-wrapped (part-key roleTable registration)',
    ).toBeDefined()
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
      `let a = cad.import_step({ path: 'fixtures/box_boss.step' })\nlet r = a`,
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

// ── brepkit 引擎（方案 docs/plans/2026-10-11-brepkit-step-io.md：无引擎门禁）──

describe('import_step: brepkit engine (no gate)', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  const brepkitPorts = (): HostPorts => ({
    events: { emit: () => undefined },
    hostEnv: 'node',
    assets: {
      resolveByKey: async () => ({ bytes: STEP_BUFFER }),
      resolveFile: async () => STEP_BUFFER,
      resolveUrl: async () => STEP_BUFFER,
    },
  } as unknown as HostPorts)

  // 2026-10-13：切换到上游 `brepkit-wasm@4.1.49`——其已包含
  // SURFACE_CURVE / SEAM_CURVE / INTERSECTION_CURVE 的 reader 修复
  // （按 3D 基曲线读入），外部（occt / CadQuery）写的 STEP 在 brepkit 引擎下
  // 可直接读入。此前用旧版上游 brepkit-wasm 时 box_boss.step 会抛
  // `unsupported STEP entity: SURFACE_CURVE`，故本用例曾 skip。
  it('reads a .step path under brepkit → solid with volume > 0', async () => {
    const { registerBrepkitBrepEngine } = await import('../../src/brep/engine/adapters/brepkit')
    await registerBrepkitBrepEngine()
    const runtime = createEditorRuntime(brepkitPorts(), 'brep')
    const result = await runtime.execute(
      `let a = cad.import_step({ path: 'fixtures/box_boss.step' })\nlet r = a`,
    )
    expect(result.failedAt).toBeUndefined()
    const entry = result.brepSolids!.get(asPartName('a'))
    expect(entry, 'import_step result lands in brepSolids').toBeDefined()
    expect(entry!.kernel.getVolume(entry!.solid)).toBeGreaterThan(0)
  })

  it('roundtrip: brepkit exportStep → import_step → same volume', async () => {
    const { registerBrepkitBrepEngine } = await import('../../src/brep/engine/adapters/brepkit')
    await registerBrepkitBrepEngine()
    // 第一段：建 box 并导出 STEP 文本（exportStep 返回 activeValue，不落盘）。
    const runtimeA = createEditorRuntime(brepkitPorts(), 'brep')
    const r0 = await runtimeA.execute(
      `let p = cad.box(10, 10, 10)\nlet txt = cad.exportStep(p)`,
    )
    expect(r0.failedAt).toBeUndefined()
    const stepText = r0.activeValues!.get('txt' as never) as string
    expect(stepText.startsWith('ISO-10303-21')).toBe(true)
    // 第二段：把导出文本作为文件喂回 import_step（体积一致即往返）。
    const roundtripBuffer = new TextEncoder().encode(stepText).buffer
    const runtimeB = createEditorRuntime(
      {
        events: { emit: () => undefined },
        hostEnv: 'node',
        assets: {
          resolveByKey: async () => null,
          resolveFile: async () => roundtripBuffer,
          resolveUrl: async () => null,
        },
      } as unknown as HostPorts,
      'brep',
    )
    const result = await runtimeB.execute(
      `let b = cad.import_step({ path: 'roundtrip.step' })\nlet r = b`,
    )
    expect(result.failedAt).toBeUndefined()
    const entry = result.brepSolids!.get(asPartName('b'))
    expect(entry).toBeDefined()
    expect(entry!.kernel.getVolume(entry!.solid)).toBeCloseTo(1000, 6)
  })
})
