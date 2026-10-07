/**
 * S2 regression: the scan must NOT flag a legitimately engine-agnostic op as L3.
 * GOTCHA: an op's function-slice can swallow (or orphan) non-exported top-level
 * helpers that sit between exported functions, mis-attributing occt kernel calls.
 *
 * Repo fact shadowed by the bug:
 *   - `healSolidBrep` (healingFns.ts) is engine-agnostic — it routes through
 *     `getBrepApi()`/L1 contract and never calls occt's `healFace`/`healWire`.
 *   - occt's `healFace` / `healWire` are reached by the `heal` op
 *     (`healBrep` → `healFaceBrep` / `healWireBrep`), which already declares
 *     `engines: ['occt']` → **C2**, not L3.
 *   - `getShapeType` is a `BrepEngineApi` contract member → **C1**, not L3.
 *   - The fragile version of `exportRange` sliced `healSolidBrep` up to the *next*
 *     `export`, swallowing the non-exported `healFaceBrep`/`healWireBrep` and
 *     falsely flagging `healSolid → { healFace, healWire, getShapeType }` as L3.
 *     Adding `engines:['occt']` to healSolid would have "fixed" the scan but would
 *     have wrongly narrowed healSolid to occt-only (breaking brepkit parity). The
 *     correct fix is the scan's transitive-local-helper attribution.
 *
 * Acceptance: L3 must be empty; healFace/healWire ∈ C2; getShapeType ∈ C1.
 * Frozen in occt-op-coverage.json by scripts/scan-occt-op-coverage.ts (scan:occt-ops).
 */
import { describe, it, expect } from 'vitest'
import coverage from '../../src/api/surface/occt-op-coverage.json'

const C2 = new Set(coverage.C2)
const L3 = new Set(coverage.L3)
const C1 = new Set(coverage.C1)
const C3 = new Set(coverage.C3)
const C4 = new Set(coverage.C4)
const C5 = new Set(coverage.C5)
const C6 = new Set(coverage.C6)

describe('occt-op-coverage baseline (S2: L3 must be cleared honestly)', () => {
  it('L3 is empty — no op reaches occt without an engines declaration', () => {
    expect([...L3]).toEqual([])
    expect(coverage.l3Ops).toEqual({})
  })

  it('healFace / healWire are C2 platform-reach (from the declared heal op); getShapeType is C1 contract', () => {
    // occt's `healFace` / `healWire` are reached by the engines:['occt']-declared `heal` op
    // (healBrep → healFaceBrep / healWireBrep) → C2, not L3.
    expect(C2.has('healFace')).toBe(true)
    expect(C2.has('healWire')).toBe(true)
    // `getShapeType` is a BrepEngineApi contract member (neutral engine) → C1.
    expect(C1.has('getShapeType')).toBe(true)
  })

  it('six-class classification is disjoint and covers exactly all kernel methods', () => {
    const classifications: Array<[string, Set<string>]> = [
      ['C1', C1], ['C2', C2], ['L3', L3], ['C3', C3], ['C4', C4], ['C5', C5], ['C6', C6],
    ]
    // pairwise disjoint
    for (let i = 0; i < classifications.length; i++) {
      for (let j = i + 1; j < classifications.length; j++) {
        const overlap = [...classifications[i][1]].filter((m) => classifications[j][1].has(m))
        expect(overlap, `overlap ${classifications[i][0]} ∩ ${classifications[j][0]}`).toEqual([])
      }
    }
    // union == 211
    const union = new Set<string>()
    for (const [, s] of classifications) for (const m of s) union.add(m)
    expect(union.size).toBe(coverage.exhaustiveness!.sum)
    expect(coverage.exhaustiveness!.sum).toBe(coverage.kernelMethodCount)
  })
})