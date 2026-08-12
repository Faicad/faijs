import { describe, it, expect } from 'vitest'
import {
  vec3Cross, vec3Dot, vec3Normalize, vec3Scale, vec3Add, vec3Sub,
  vec3RotateAroundAxis,
} from './dovetail-math'

describe('vec3 helpers', () => {
  it('vec3Cross computes cross product', () => {
    const result = vec3Cross([1, 0, 0], [0, 1, 0])
    expect(result[0]).toBeCloseTo(0, 10)
    expect(result[1]).toBeCloseTo(0, 10)
    expect(result[2]).toBeCloseTo(1, 10)
  })

  it('vec3Dot computes dot product', () => {
    expect(vec3Dot([1, 2, 3], [4, 5, 6])).toBe(32)
  })

  it('vec3Normalize returns unit vector', () => {
    const result = vec3Normalize([3, 0, 4])
    expect(result[0]).toBeCloseTo(0.6, 10)
    expect(result[1]).toBeCloseTo(0, 10)
    expect(result[2]).toBeCloseTo(0.8, 10)
  })

  it('vec3Normalize returns zero for zero-length input', () => {
    const result = vec3Normalize([0, 0, 0])
    expect(result).toEqual([0, 0, 0])
  })

  it('vec3Scale scales correctly', () => {
    const result = vec3Scale([1, 2, 3], 2.5)
    expect(result).toEqual([2.5, 5, 7.5])
  })

  it('vec3Add adds correctly', () => {
    const result = vec3Add([1, 2, 3], [4, 5, 6])
    expect(result).toEqual([5, 7, 9])
  })

  it('vec3Sub subtracts correctly', () => {
    const result = vec3Sub([4, 5, 6], [1, 2, 3])
    expect(result).toEqual([3, 3, 3])
  })
})

describe('vec3RotateAroundAxis', () => {
  it('rotating (1,0,0) around Z by 90° gives (0,1,0)', () => {
    const result = vec3RotateAroundAxis([1, 0, 0], [0, 0, 1], Math.PI / 2)
    expect(result[0]).toBeCloseTo(0, 10)
    expect(result[1]).toBeCloseTo(1, 10)
    expect(result[2]).toBeCloseTo(0, 10)
  })

  it('rotating (0,0,1) around Y by 90° gives (1,0,0)', () => {
    const result = vec3RotateAroundAxis([0, 0, 1], [0, 1, 0], Math.PI / 2)
    expect(result[0]).toBeCloseTo(1, 10)
    expect(result[1]).toBeCloseTo(0, 10)
    expect(result[2]).toBeCloseTo(0, 10)
  })

  it('rotating (0,0,1) around Y by -60° gives correct result', () => {
    const result = vec3RotateAroundAxis([0, 0, 1], [0, 1, 0], -Math.PI / 3)
    expect(result[0]).toBeCloseTo(-Math.sin(Math.PI / 3), 10)
    expect(result[1]).toBeCloseTo(0, 10)
    expect(result[2]).toBeCloseTo(Math.cos(Math.PI / 3), 10)
  })

  it('zero rotation returns the same vector', () => {
    const result = vec3RotateAroundAxis([1, 2, 3], [0, 0, 1], 0)
    expect(result[0]).toBeCloseTo(1, 10)
    expect(result[1]).toBeCloseTo(2, 10)
    expect(result[2]).toBeCloseTo(3, 10)
  })

  it('360° rotation returns the same vector', () => {
    const result = vec3RotateAroundAxis([1, 0, 0], [0, 0, 1], Math.PI * 2)
    expect(result[0]).toBeCloseTo(1, 10)
    expect(result[1]).toBeCloseTo(0, 10)
    expect(result[2]).toBeCloseTo(0, 10)
  })
})
