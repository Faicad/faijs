/**
 * admit-compat-lib.test.ts — Phase 2.11-① naming declaration channel tests.
 *
 * Pins the declaration precedence for bare-function lifts:
 *   `fn.naming` (function-level) → `options.naming` (library-level) →
 *   blanket `BARE_LIFT_FALLBACK_NAMING` (unmodeled).
 *
 * GOTCHA (plan §1 D11 ⚠️): the blanket fallback is an explicit, named constant
 * here — 2.11-③ decides whether it hard-fails. These tests pin whichever
 * behavior exists; change them together with the constant.
 */

import { describe, expect, it } from 'vitest'
import { admitCompatLib } from './admit-compat-lib'
import { DUAL_OP_META, type DualOpMeta } from '../define-op'
import { CONTRACT_VERSION } from '../runtime-state'
import type { Provenance } from '../topology/naming/lineage'

/** Minimal conforming library namespace (contractVersion + bare functions). */
function lib(fns: Record<string, (...a: unknown[]) => unknown>): Record<string, unknown> {
  return { contractVersion: CONTRACT_VERSION, ...fns }
}

function metaOf(ns: Record<string, unknown>, name: string): DualOpMeta {
  const fn = ns[name] as { [DUAL_OP_META]?: DualOpMeta }
  const meta = fn?.[DUAL_OP_META]
  expect(meta, `${name} must carry DUAL_OP_META after lift`).toBeDefined()
  return meta!
}

describe('Phase 2.11：naming 声明通道', () => {
  it('2.11-③：无任何声明 → 硬失败（不再有 blanket unmodeled 兜底，D11）', () => {
    expect(() => admitCompatLib(lib({ foo: () => ({}) }))).toThrow(/no naming declaration/)
  })

  it('函数级 fn.naming 优先于库级 options.naming', () => {
    const fnNaming: Provenance = { kind: 'identity' }
    const libNaming: Provenance = { kind: 'unmodeled', reason: 'lib default' }
    const bare = Object.assign(() => ({}), { naming: fnNaming })
    const out = admitCompatLib(lib({ shaped: bare }), { naming: libNaming })
    expect(metaOf(out, 'shaped').naming).toEqual(fnNaming)
  })

  it('仅库级 options.naming → 无 fn.naming 的函数用它', () => {
    const libNaming: Provenance = { kind: 'unmodeled', reason: 'lib default' }
    const out = admitCompatLib(lib({ foo: () => ({}) }), { naming: libNaming })
    expect(metaOf(out, 'foo').naming).toEqual(libNaming)
  })

  it('已带 DUAL_OP_META 的原生 dual-op 原样透传（naming 不被改写）', () => {
    const dual: Provenance = { kind: 'kernel', newFaces: { via: 'byAdjacency' } }
    // 真 dual-op 形态：meta 必须带实现（assertLibConforms 校验 mesh/brep 至少一个），用 compatOp 造。
    const native = Object.assign(() => ({}), {
      [DUAL_OP_META]: { kind: 'dual-op', brep: () => ({}), naming: dual } as unknown as DualOpMeta,
    })
    const out = admitCompatLib(lib({ native }))
    expect(out.native).toBe(native) // 同一引用，未包装
  })

  it('非函数成员（contractVersion）原样透传', () => {
    const src = lib({})
    const out = admitCompatLib(src)
    expect(out.contractVersion).toBe(CONTRACT_VERSION)
  })
})
