/**
 * meshIndex.test.ts — QuantizedPointMap + weldVertices (meshIndex.ts).
 *
 * Covers:
 *   - new QuantizedPointMap(quant, expected)
 *   - get(x,y,z), getOrSet(x,y,z,value), .inserted, .size
 *   - weldVertices(pos, count, quant)
 *
 * Numeric invariants asserted: quantization collapses co-located points to the
 * same key; first-writer-wins id assignment; absent keys return -1.
 */
import { describe, it, expect } from 'vitest'
import { QuantizedPointMap, weldVertices } from './meshIndex'

describe('QuantizedPointMap', () => {
  it('returns -1 for an absent key', () => {
    const m = new QuantizedPointMap(1e5)
    expect(m.get(0, 0, 0)).toBe(-1)
    expect(m.size).toBe(0)
  })

  it('getOrSet inserts and reports insertion on the first write', () => {
    const m = new QuantizedPointMap(1)
    const v = m.getOrSet(1.2, 3.4, 5.6, 42)
    expect(v).toBe(42)
    expect(m.inserted).toBe(true)
    expect(m.size).toBe(1)
    expect(m.get(1.2, 3.4, 5.6)).toBe(42)
  })

  it('returns the existing value and does not re-insert on a repeat write', () => {
    const m = new QuantizedPointMap(1)
    expect(m.getOrSet(1, 2, 3, 10)).toBe(10)
    const repeated = m.getOrSet(1, 2, 3, 99)
    expect(repeated).toBe(10) // first write wins
    expect(m.inserted).toBe(false)
    expect(m.size).toBe(1)
  })

  it('quantizes positions: near-identical keys collapse together', () => {
    const quant = 10 // rounds at 1/depth resolution
    const m = new QuantizedPointMap(quant)
    // 0.1 and 0.14 both round to bucket 1/sum -> same key.
    expect(m.getOrSet(0.1, 0, 0, 1)).toBe(1)
    expect(m.getOrSet(0.14, 0, 0, 99)).toBe(1) // first write wins, same bucket
    expect(m.inserted).toBe(false)
    expect(m.size).toBe(1)
    expect(m.get(0.12, 0, 0)).toBe(1)
    // 0.19 rounds to bucket 2 -> a distinct key.
    expect(m.getOrSet(0.19, 0, 0, 2)).toBe(2)
    expect(m.size).toBe(2)
  })

  it('scales the internal table up without losing keys (grow path)', () => {
    const m = new QuantizedPointMap(1, 4) // small expected -> triggers growth
    const keys: [number, number, number][] = []
    for (let i = 0; i < 200; i++) {
      const p: [number, number, number] = [i, i * 2, i * 3]
      keys.push(p)
      expect(m.getOrSet(p[0], p[1], p[2], i)).toBe(i)
    }
    expect(m.size).toBe(200)
    keys.forEach((p, i) => {
      expect(m.get(p[0], p[1], p[2])).toBe(i)
    })
  })
})

describe('weldVertices', () => {
  it('assigns each unique position a distinct id, first occurrence wins', () => {
    const pos = new Float32Array([
      0, 0, 0, // vertex 0 -> id 0
      1, 0, 0, // vertex 1 -> id 1
      0, 0, 0, // vertex 2 -> id 0 (dup of v0)
      2, 0, 0, // vertex 3 -> id 2
    ])
    const { vertexId, uniqueCount } = weldVertices(pos, 4, 1e5)
    expect([...vertexId]).toEqual([0, 1, 0, 2])
    expect(uniqueCount).toBe(3)
  })

  it('collapses coordinates that round to the same quantized bucket', () => {
    const pos = new Float32Array([0, 0, 0, 0.0000001, 0, 0, 0.0000002, 0, 0])
    const { vertexId, uniqueCount } = weldVertices(pos, 3, 1e5)
    expect(uniqueCount).toBe(1)
    expect([...vertexId]).toEqual([0, 0, 0])
  })

  it('returns one unique id per distinct position even when all are distinct', () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0])
    const { vertexId, uniqueCount } = weldVertices(pos, 4, 1e5)
    expect(uniqueCount).toBe(4)
    expect(new Set([...vertexId]).size).toBe(4)
  })
})