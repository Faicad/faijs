/**
 * chamfer-math pure functions — T-A1 (無wasm, §3.5 self-check table).
 */
import { describe, it, expect } from 'vitest'
import {
  materialDihedralFromNormalAngle,
  angleBetweenNormals,
  chamferAngleFromDistances,
  chamferCheckDO,
} from './chamfer-math'

const rad = (deg: number): number => (deg * Math.PI) / 180
const deg = (rad: number): number => (rad * 180) / Math.PI

describe('chamfer-math (T-A1)', () => {
  it('box edge: γ = 90° → β = 90°', () => {
    expect(deg(materialDihedralFromNormalAngle(angleBetweenNormals(0)))).toBeCloseTo(90, 9)
  })

  it('self-check row: cube 1:1 → θ = 45°', () => {
    const beta = rad(90)
    const theta = chamferAngleFromDistances(1, 1, beta)
    expect(deg(theta)).toBeCloseTo(45, 9)
    expect(chamferCheckDO(1, theta, beta)).toBeCloseTo(1, 9)
  })

  it('self-check row: cube 2:1 → θ = 26.5651°', () => {
    const beta = rad(90)
    const theta = chamferAngleFromDistances(2, 1, beta)
    expect(deg(theta)).toBeCloseTo(26.5651, 3)
    expect(chamferCheckDO(2, theta, beta)).toBeCloseTo(1, 6)
  })

  it('self-check row: dF=10, dO=5, β=60° → dO_check back', () => {
    const beta = rad(60)
    const theta = chamferAngleFromDistances(10, 5, beta)
    expect(chamferCheckDO(10, theta, beta)).toBeCloseTo(5, 9)
  })

  it('angleBetweenNormals clamps acos input', () => {
    expect(angleBetweenNormals(1)).toBeCloseTo(0, 9)
    expect(angleBetweenNormals(-1)).toBeCloseTo(Math.PI, 9)
    expect(angleBetweenNormals(1.5)).toBeCloseTo(0, 9)
    expect(angleBetweenNormals(-1.5)).toBeCloseTo(Math.PI, 9)
  })

  it('inner/reflex edge (β ≥ 180°) throws E_CHAMFER_REFLEX_EDGE', () => {
    expect(() => chamferAngleFromDistances(1, 1, rad(180))).toThrow(/E_CHAMFER_REFLEX_EDGE/)
    expect(() => chamferAngleFromDistances(1, 1, rad(200))).toThrow(/E_CHAMFER_REFLEX_EDGE/)
  })
})
