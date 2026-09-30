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
// GOTCHA（2026-09-30）：import_brep 现为 defineOp 包装（part 键 roleTable 在包装层
// 登记）。契约层错误路径测试必须直调裸实现 importBrepImpl——包装层 dispatch 在参数
// 校验前就按 engines/后端拦截，会先抛 E_MESH_UNSUPPORTED/E_BREP_UNSUPPORTED，
// 盖住 OpError 契约错误。
import { importBrepImpl } from './import-brep'
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
    await expect(importBrepImpl({ asset: 'x' })).rejects.toThrow(OpError)
    await expect(importBrepImpl({ asset: 'x' })).rejects.toThrow(/assets backend is required/)
  })

  it('mesh mode (no OCCT kernel) → BrepUnsupportedError', async () => {
    configureBackends(makeBackends('mesh', undefined, fakeAssets))
    await expect(importBrepImpl({ asset: 'Array001.Shape' })).rejects.toThrow(BrepUnsupportedError)
  })

  it('invalid asset arg (non-string) → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', undefined, fakeAssets))
    await expect(importBrepImpl({ asset: 123 })).rejects.toThrow(OpError)
    await expect(importBrepImpl({ asset: 123 })).rejects.toThrow(/asset name \(string\) is required/)
  })

  it('empty asset name → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', undefined, fakeAssets))
    await expect(importBrepImpl({ asset: '' })).rejects.toThrow(/asset name \(string\) is required/)
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
      surfaceCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
      uvBounds: () => ({ uMin: 0, uMax: 0, vMin: 0, vMax: 0 }),
      area: () => 1,
      centerOfMass: () => ({ x: 0, y: 0, z: 0 }),
    }
    configureBackends(makeBackends('brep', { ...fakeKernel }, fakeAssets))

    await importBrepImpl({ asset: 'Sketch001.Shape' })
    // 1.10 前置③：roleTable 权威落点 = 血缘图旁挂（语句键 + part 键），slot 缓存字段已删。
    // 本单测无语句锚点 ⇒ 注入空串锚点（与表的 origin='' 占位一致），读语句键表。
    const { setCurrentStmt } = await import('../runtime-state')
    const { runtimeLineage } = await import('../topology/naming/lineage')
    setCurrentStmt({ id: '' as never, outputs: [] as never })
    try {
      // 重跑一次让 fromBrep 在锚点内记录（首次调用发生在注入前）
      await importBrepImpl({ asset: 'Sketch001.Shape' })
    } finally {
      setCurrentStmt(undefined)
    }
    const table = runtimeLineage.outputTableOf('' as never) as RoleTable | undefined
    expect(table, 'roleTable registered on the imported shape').toBeDefined()
    const origins = [...(table?.keys() ?? [])]
    // Phase 1.6：origin = 导入语句的 StmtId（不再用资产名——同一资产导入两次
    // 是两条语句，天然分属不同 origin）。本单测无语句锚点 ⇒ 空串占位。
    expect(origins).toEqual([''])
    // 2026-09-30 GOTCHA（nameless-shape 修复）：part 键 roleTable（outputTablesByPart）
    // 必须由 defineOp 包装层登记——`LineageGraph.tableOfPart` 是 place 等下游 op 的
    // inputRoleTable 唯一读口。裸 async 函数只落语句键表（上面 `outputTableOf` 读得到），
    // 下游 place 产物断流，edgeRef 报 "no role table (nameless shape)"（fcstd 语料 43 例）。
    // 本单测直调裸实现且没有 executor，part 名根本不存在，故此处无法断言 part 键表本身
    // （LineageGraph 也没有暴露全表快照的读口）——改为断言包装层在位，端到端的部分由
    // fcstd-port 语料 e2e 覆盖。
    // 包装层断言：import_brep 必须是 defineOp 包装（有 DUAL_OP_META），否则 part 键登记链路断裂
    const { DUAL_OP_META } = await import('../define-op')
    expect((import_brep as unknown as Record<symbol, unknown>)[DUAL_OP_META as unknown as symbol], 'import_brep must be defineOp-wrapped (part-key roleTable registration)').toBeDefined()
    // Phase 3.8：imported:<i> 命名落地 — 每个面按枚举序命名（imported:0, imported:1, ...）
    const roles = table?.get('' as StmtId)
    expect(roles?.size).toBe(2)
    expect(roles?.get('imported:0')).toEqual([101])
    expect(roles?.get('imported:1')).toEqual([102])
  })
})
