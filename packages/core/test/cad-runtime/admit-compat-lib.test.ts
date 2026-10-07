/**
 * admit-compat-lib.test.ts — library admission tests (2026-09-23).
 *
 * Library authors no longer declare face naming: `fn.naming` / `options.naming` /
 * `namingFor` / `faijs.naming` were removed.
 * Every bare function is admitted with the fixed default unmodeled provenance
 * (faces get no stable identity; face references degrade to geometric matching).
 * Op-level naming (defineOp's DUAL_OP_META.naming) is the only naming channel.
 */

import { describe, expect, it } from 'vitest'
import { admitCompatLib } from '../../src/cad-runtime/admit-compat-lib'
import { DUAL_OP_META, type DualOpMeta } from '../../src/define-op'
import { CONTRACT_VERSION } from '../../src/runtime-state'

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

describe('admitCompatLib — 裸函数默认接纳（无命名声明）', () => {
  it('裸函数无任何声明 → 默认接纳，naming = 默认 unmodeled（reason 带 default: 前缀）', () => {
    const out = admitCompatLib(lib({ foo: () => ({}) }))
    const naming = metaOf(out, 'foo').naming
    expect(naming).toMatchObject({ kind: 'unmodeled' })
    expect(String(naming?.kind === 'unmodeled' ? naming.reason : '')).toMatch(/^default:/)
  })

  it('带 DUAL_OP_META 的原生 dual-op 原样透传（naming 不被改写）', () => {
    // 真 dual-op 形态：meta 必须带实现（assertLibConforms 校验 mesh/brep 至少一个），用 compatOp 造。
    const native = Object.assign(() => ({}), {
      [DUAL_OP_META]: { kind: 'dual-op', brep: () => ({}), naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } } as unknown as DualOpMeta,
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
