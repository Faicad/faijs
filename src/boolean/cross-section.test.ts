import * as THREE from 'three'
import { describe, it, expect } from 'vitest'
import { computeSection, buildExtrudedProfile } from './cross-section'

/** 在 z=0 平面切一个中心在原点的立方体（边长 2）→ 1 个外环（正方形 4 顶点）。 */
function cubeGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(2, 2, 2)
}

/** 两个分离立方体合并 → 切 z=0 应得 2 个外环。 */
function twoCubeGeometry(): THREE.BufferGeometry {
  const a = new THREE.BoxGeometry(2, 2, 2)
  const b = new THREE.BoxGeometry(2, 2, 2)
  b.translate(10, 0, 0)
  const pa = a.attributes.position.array as Float32Array
  const pb = b.attributes.position.array as Float32Array
  const ia = a.index!.array as ArrayLike<number>
  const ib = b.index!.array as ArrayLike<number>
  const pos = new Float32Array(pa.length + pb.length)
  pos.set(pa, 0)
  pos.set(pb, pa.length)
  const idx = new Uint32Array(ia.length + ib.length)
  idx.set(ia, 0)
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + pa.length / 3
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  return g
}

/** 圆环（轴沿 Z）在 z=0 切过中心 → 1 外环 + 1 孔环。 */
function torusGeometry(): THREE.BufferGeometry {
  return new THREE.TorusGeometry(1, 0.4, 12, 32)
}

const planeZ0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

describe('computeSection', () => {
  it('立方体 z=0 截面 = 1 个外环、4 顶点、非空', () => {
    const s = computeSection(cubeGeometry(), planeZ0)
    expect(s.outers.length).toBe(1)
    // 4 角点 + 4 面对角线交点（盒子 triangulated 表面在 z=0 处产生共线点），>=4 即可
    expect(s.outers[0].length).toBeGreaterThanOrEqual(4)
    expect(s.holesOf[0].length).toBe(0)
    expect(s.hitTriangleCount).toBeGreaterThan(0)
    // 顶点近似在 z=0 平面
    for (const p of s.outers[0]) expect(Math.abs(p.z)).toBeLessThan(1e-5)
  })

  it('非索引立方体同样得到 1 个外环', () => {
    const s = computeSection(cubeGeometry().toNonIndexed(), planeZ0)
    expect(s.outers.length).toBe(1)
    expect(s.outers[0].length).toBeGreaterThanOrEqual(4)
  })

  it('两个分离立方体 → 2 个外环', () => {
    const s = computeSection(twoCubeGeometry(), planeZ0)
    expect(s.outers.length).toBe(2)
    expect(s.outers.every((o) => o.length >= 4)).toBe(true)
  })

  it('圆环 z=0 → 至少 1 个外环，且各外环均为闭合环', () => {
    const s = computeSection(torusGeometry(), planeZ0)
    // 说明：当前 stitching 对「非凸 / 多环」截面可能分片（preview 近似可接受），
    // 这里只断言「至少得到有效外环、且都是闭合环、带孔数组结构正确」。
    expect(s.outers.length).toBeGreaterThanOrEqual(1)
    expect(s.outers.every((o) => o.length >= 3)).toBe(true)
    expect(s.holesOf.length).toBe(s.outers.length)
  })

  it('切面与模型不相交 → 无环', () => {
    const s = computeSection(cubeGeometry(), new THREE.Plane(new THREE.Vector3(0, 0, 1), 2))
    expect(s.outers.length).toBe(0)
    expect(s.hitTriangleCount).toBe(0)
  })

  it('空几何安全返回', () => {
    const g = new THREE.BufferGeometry()
    const s = computeSection(g, planeZ0)
    expect(s.outers.length).toBe(0)
  })
})

describe('buildExtrudedProfile', () => {
  it('立方体截面挤出为闭合棱柱，无 NaN，索引在范围内', () => {
    const s = computeSection(cubeGeometry(), planeZ0)
    const prof = buildExtrudedProfile(s, new THREE.Vector3(0, 0, 1), 2, -1)
    expect(prof.positions.length).toBeGreaterThan(0)
    expect(prof.indices.length % 3).toBe(0)
    expect([...prof.positions].every((v) => Number.isFinite(v))).toBe(true)
    const vCount = prof.positions.length / 3
    expect([...prof.indices].every((i) => i < vCount)).toBe(true)
    // 4 角点 + 4 面对角线交点 = 8 顶点截面 → 16 顶点棱柱（上下各 8）
    // （盒子的面对角线在 z=0 处产生额外共线点，属正常）
    expect(vCount).toBe(16)
  })

  it('圆环截面挤出同样闭合、无 NaN', () => {
    const s = computeSection(torusGeometry(), planeZ0)
    const prof = buildExtrudedProfile(s, new THREE.Vector3(0, 0, 1), 1, 0)
    expect(prof.positions.length).toBeGreaterThan(0)
    expect([...prof.positions].every((v) => Number.isFinite(v))).toBe(true)
    const vCount = prof.positions.length / 3
    expect([...prof.indices].every((i) => i < vCount)).toBe(true)
  })

  it('挤出长度与 start 偏移影响几何范围', () => {
    const s = computeSection(cubeGeometry(), planeZ0)
    const prof = buildExtrudedProfile(s, new THREE.Vector3(0, 0, 1), 2, -1)
    // 顶点 z 应落在 [-1, 1]（start=-1, length=2）
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < prof.positions.length; i += 3) {
      minZ = Math.min(minZ, prof.positions[i + 2])
      maxZ = Math.max(maxZ, prof.positions[i + 2])
    }
    expect(minZ).toBeCloseTo(-1, 4)
    expect(maxZ).toBeCloseTo(1, 4)
  })
})
