/**
 * import_brep — 平台 BREP 资产导入 op 测试（H11 / 方案 §4.1）
 *
 * 覆盖（无需 WASM 的契约层）：
 * - 无 assets 后端 → OpError E_OP_FAILED
 * - mesh 模式（无 OCCT 内核）→ BrepUnsupportedError（brep 专属，不静默回退）
 * - asset 参数非法（非字符串）→ OpError E_ARGS
 * - C6 非实体放行：import_brep 始终以 allowNonSolid 调用 loadBrep（见源码
 *   `{ allowNonSolid: true }`），wire/face/shell 一等公民；需要实体的 op 在使用点
 *   报错（V-C8）。该行为由源码保证，端到端放行由 fcstd 普查 e2e 验证。
 */

import { describe, expect, it } from 'vitest'
import { configureBackends, CONTRACT_VERSION, BrepUnsupportedError, type Backends } from '../runtime-state'
import { OpError } from '../api/internal/result-unwrap'
import { import_brep } from './import-brep'
import type { RoleTable } from '../topology/naming/types'
import type { StmtId } from '../identity'

// ── helpers ──

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
  resolveByKey: async (_key: string) => ({
    bytes: new TextEncoder().encode('CASCADE Topology 1, (ASCII)').buffer,
  }),
}

// ── 契约层错误路径 ──

describe('import_brep: contract errors', () => {
  it('no assets backend → OpError E_OP_FAILED', async () => {
    configureBackends(makeBackends('auto'))
    await expect(import_brep({ asset: 'x' })).rejects.toThrow(OpError)
    await expect(import_brep({ asset: 'x' })).rejects.toThrow(/assets backend is required/)
  })

  it('mesh mode (no OCCT kernel) → BrepUnsupportedError', async () => {
    configureBackends(makeBackends('mesh', undefined, fakeAssets))
    await expect(import_brep({ asset: 'Array001.Shape' })).rejects.toThrow(BrepUnsupportedError)
  })

  it('invalid asset arg (non-string) → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', undefined, fakeAssets))
    await expect(import_brep({ asset: 123 })).rejects.toThrow(OpError)
    await expect(import_brep({ asset: 123 })).rejects.toThrow(/asset name \(string\) is required/)
  })

  it('empty asset name → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', undefined, fakeAssets))
    await expect(import_brep({ asset: '' })).rejects.toThrow(/asset name \(string\) is required/)
  })
})

// ── E3: chain-root roleTable ──

// GOTCHA（E3 / nameless-shape，2026-09-21）：冻结资产导入后必须带链根
// roleTable，否则下游 edgeRef/faceRef 报 "input shape has no role table
// (nameless shape)"（56 样本普查的 nameless-shape 缺陷 ×2）。表 origin 用
// 资产名，opType 用 'import_brep'（位置名兜底，与 primitives 链根建表同源）。
// WASM 端到端（真内核 assignRoles + edgeRef 解析）由 fcstd-port 语料普查钉。
describe('import_brep: chain-root roleTable (E3)', () => {
  it('registers a roleTable keyed by the asset name', async () => {
    const faceHandles = [{}] as unknown[]
    const fakeKernel = {
      // loadBrep: CASCADE head + one solid sub-shape
      fromBREP: () => ({ h: 1 }),
      importStep: () => { throw new Error('not a STEP') },
      getSubShapes: (_shape: unknown, kind: string) => (kind === 'solid' ? [{}] : kind === 'face' ? faceHandles : []),
      release: () => undefined,
      subShapeHashes: (_s: unknown, kind: string) => (kind === 'face' ? [101, 102] : []),
      meshShape: () => ({ positions: [0, 0, 0], indices: [] }),
      // captureFaceHint（assignRoles → 语义命名）需要的几何量 stub
      surfaceType: () => 'plane',
      surfaceNormal: () => [0, 0, 1],
      getSurfaceCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
      uvBounds: () => ({ uMin: 0, uMax: 0, vMin: 0, vMax: 0 }),
      area: () => 1,
      centerOfMass: () => ({ x: 0, y: 0, z: 0 }),
    }
    configureBackends(makeBackends('brep', { ...fakeKernel }, fakeAssets))

    const out = await import_brep({ asset: 'Sketch001.Shape' })
    const { getSlot } = await import('../shape')
    const slot = getSlot(out)
    const table = slot?.roleTable as RoleTable | undefined
    expect(table, 'roleTable registered on the imported shape').toBeDefined()
    const origins = [...(table?.keys() ?? [])]
    // Phase 1.6：origin = 导入语句的 StmtId（不再用资产名——同一资产导入两次
    // 是两条语句，天然分属不同 origin）。本单测无语句锚点 ⇒ 空串占位。
    expect(origins).toEqual([''])
    // Phase 1.7：'import_brep' 无语义命名器且位置兜底已删 ⇒ 子表为空占位
    // （真实导入的 imported:<i> 词汇待 Phase 3.8；面行显式 role=null）。
    const roles = table?.get('' as StmtId)
    expect(roles?.size).toBe(0)
  })
})
