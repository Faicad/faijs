/**
 * face-evolution hash 键解码测试（§2.4 / §3.4，M1）
 *
 * decodeHashEvolution / splitHashEvolutionByOrigin 是纯函数，不 init wasm。
 */

import { describe, it, expect } from 'vitest'
import { decodeHashEvolution, splitHashEvolutionByOrigin } from './face-evolution'
import type { BrepEvolutionData } from './engine/types'

describe('decodeHashEvolution', () => {
  it('decodes the packed modified segments into a hash map', () => {
    // 分段编码：[inHash, count, outHash...] × N
    const evo: BrepEvolutionData = {
      result: 0 as never,
      modified: [
        101, 1, 201,  // 101 → [201]
        102, 2, 202, 203,  // 102 → [202, 203]（1→2 分裂）
      ],
      generated: [999],
      deleted: [103, 104],
    }
    const hashEvo = decodeHashEvolution(evo)
    expect(hashEvo.modified.get(101)).toEqual([201])
    expect(hashEvo.modified.get(102)).toEqual([202, 203])
    expect(hashEvo.modified.size).toBe(2)
    expect([...hashEvo.deleted]).toEqual([103, 104])
  })

  it('handles empty modified segments', () => {
    const hashEvo = decodeHashEvolution({ result: 0 as never, modified: [], generated: [], deleted: [] })
    expect(hashEvo.modified.size).toBe(0)
    expect(hashEvo.deleted.size).toBe(0)
  })

  it('does not consume generated hashes (R2: 生成面不进 role 传播)', () => {
    const evo: BrepEvolutionData = {
      result: 0 as never,
      modified: [101, 1, 201],
      generated: [777, 888],
      deleted: [],
    }
    const hashEvo = decodeHashEvolution(evo)
    // generated 只是原样忽略——不进 modified/deleted
    expect(hashEvo.modified.get(777)).toBeUndefined()
    expect(hashEvo.deleted.has(888)).toBe(false)
  })
})

describe('splitHashEvolutionByOrigin（布尔 A/B 拆流，§3.4）', () => {
  it('splits modified/deleted by A/B hash ownership', () => {
    const evo: BrepEvolutionData = {
      result: 0 as never,
      modified: [
        101, 1, 201,  // A 的面被修改
        301, 1, 401,  // B 的面被修改
      ],
      generated: [],
      deleted: [102, 302],
    }
    const { a, b } = splitHashEvolutionByOrigin(evo, [101, 102], [301, 302])
    // A 侧
    expect(a.modified.get(101)).toEqual([201])
    expect(a.modified.has(301)).toBe(false) // B 的面不进 A
    expect(a.deleted.has(102)).toBe(true)
    expect(a.deleted.has(302)).toBe(false)
    // B 侧
    expect(b.modified.get(301)).toEqual([401])
    expect(b.modified.has(101)).toBe(false)
    expect(b.deleted.has(302)).toBe(true)
    expect(b.deleted.has(102)).toBe(false)
  })

  it('drops hashes belonging to neither input', () => {
    const evo: BrepEvolutionData = {
      result: 0 as never,
      modified: [999, 1, 888],
      generated: [],
      deleted: [777],
    }
    const { a, b } = splitHashEvolutionByOrigin(evo, [101], [301])
    expect(a.modified.size).toBe(0)
    expect(b.modified.size).toBe(0)
    expect(a.deleted.size).toBe(0)
    expect(b.deleted.size).toBe(0)
  })

  it('keeps the full split successors for a 1→many split on the target side', () => {
    const evo: BrepEvolutionData = {
      result: 0 as never,
      modified: [101, 2, 201, 202],
      generated: [],
      deleted: [],
    }
    const { a } = splitHashEvolutionByOrigin(evo, [101], [])
    expect(a.modified.get(101)).toEqual([201, 202])
  })
})
