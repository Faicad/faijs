/**
 * mesh-chain-face-ref.test — 面引用在「无 role 层」的链上必须显式报错，不得空引用崩溃
 *
 * 方案：faijs/docs/plans/2026-10-20-face-identity-single-source-plan.md（P3 末尾 / §3.6）
 *
 * 历史缺陷：`FaceTopoRef` 的 `hint` 在脚本面是**运行期可选**的（用户实测的
 * `{origin:'s1', role:'top'}` 就没有 hint），而 `resolveFaceTopo` 在几何兜底路径
 * 直接 `outcomeOf(ref.hint, ...)` → `scoreCandidate` 读 `hint.surfaceType` 空引用崩溃
 * （`Cannot read properties of undefined (reading 'surfaceType')`）。这违反仓规
 * 「遇到异常直接报错并携带上下文，不准掩盖」。
 *
 * 断言：
 * 1) hint 缺失且 role 未被追踪（mesh 链没有 role 层）→ 返回显式三态 `no-hint`，不抛 TypeError；
 * 2) 由 `buildTopoError` 转成的错误文案说清「缺少几何提示、需要 role 层」；
 * 3) 有 hint、无 role 层 → 走几何兜底：能唯一匹配就成功（geometric-fallback），
 *    匹配不上就报 not-found——两条都是明确结果，不是崩溃。
 */
import { describe, it, expect } from 'vitest'
import { resolveFaceTopo, type ResolutionContext } from '@faicad/faijs/topology/naming/resolve-face'
import { buildTopoError } from '@faicad/faijs/topology/naming/resolver'
import type { FaceTopoRef } from '@faicad/faijs/topology/naming'

/** 无 roleTable 的上下文（= mesh/近似拓扑链：只有面行快照，没有命名层）。 */
function meshChainCtx(): ResolutionContext {
  return {
    kernel: null,
    faces: [
      { ordinal: 1, row: { surfaceType: 'plane', normal: [0, 0, 1], center: [0, 0, 10], area: 100 } },
      { ordinal: 2, row: { surfaceType: 'plane', normal: [0, 0, -1], center: [0, 0, 0], area: 100 } },
    ],
  }
}

describe('无 role 层 + FaceTopoRef：显式三态，不空引用崩溃', () => {
  it('hint 缺失：返回 no-hint（而不是 TypeError）', () => {
    const ref = { kind: 'face', origin: 's1', role: 'top' } as unknown as FaceTopoRef
    let r!: ReturnType<typeof resolveFaceTopo>
    expect(() => { r = resolveFaceTopo(ref, meshChainCtx()) }).not.toThrow()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-hint')
  })

  it('no-hint 的错误文案说清「缺几何提示 / 需要 role 层」', () => {
    const err = buildTopoError('no-hint', 'face')
    expect(err.message).toMatch(/hint/)
    expect(err.message).toMatch(/role layer/)
    expect(err.code).toBe('E_TOPO_NOT_FOUND')
  })

  it('有 hint、无 role 层：几何唯一匹配 → 成功（geometric-fallback）', () => {
    const ref = {
      kind: 'face',
      origin: 's1',
      role: 'top',
      hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [0, 0, 10], area: 100 },
    } as unknown as FaceTopoRef
    const r = resolveFaceTopo(ref, meshChainCtx())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ordinal).toBe(1)
      expect(r.confidence).toBe('geometric-fallback')
    }
  })

  it('有 hint 但几何不匹配：明确 not-found（不是崩溃）', () => {
    const ref = {
      kind: 'face',
      origin: 's1',
      role: 'top',
      hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [999, 999, 999], area: 100 },
    } as unknown as FaceTopoRef
    const r = resolveFaceTopo(ref, meshChainCtx())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-found')
  })
})