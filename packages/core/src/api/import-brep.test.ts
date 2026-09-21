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

import { beforeEach, describe, expect, it } from 'vitest'
import { configureBackends, CONTRACT_VERSION, BrepUnsupportedError, type Backends } from '../runtime-state'
import { OpError } from '../api/internal/result-unwrap'
import { import_brep } from './import-brep'

// ── helpers ──

function makeBackends(mode: 'auto' | 'brep' | 'mesh', assets?: unknown): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode, brepCapabilities: undefined },
    kernel: { brep: null, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: assets as Backends['assets'],
    events: { emit: () => undefined },
  } as unknown as Backends
}

const fakeAssets = {
  resolveByKey: async (_key: string) => ({ bytes: new ArrayBuffer(8) }),
}

// ── 契约层错误路径 ──

describe('import_brep: contract errors', () => {
  it('no assets backend → OpError E_OP_FAILED', async () => {
    configureBackends(makeBackends('auto'))
    await expect(import_brep({ asset: 'x' })).rejects.toThrow(OpError)
    await expect(import_brep({ asset: 'x' })).rejects.toThrow(/assets backend is required/)
  })

  it('mesh mode (no OCCT kernel) → BrepUnsupportedError', async () => {
    configureBackends(makeBackends('mesh', fakeAssets))
    await expect(import_brep({ asset: 'Array001.Shape' })).rejects.toThrow(BrepUnsupportedError)
  })

  it('invalid asset arg (non-string) → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', fakeAssets))
    await expect(import_brep({ asset: 123 })).rejects.toThrow(OpError)
    await expect(import_brep({ asset: 123 })).rejects.toThrow(/asset name \(string\) is required/)
  })

  it('empty asset name → OpError E_ARGS', async () => {
    configureBackends(makeBackends('auto', fakeAssets))
    await expect(import_brep({ asset: '' })).rejects.toThrow(/asset name \(string\) is required/)
  })
})
