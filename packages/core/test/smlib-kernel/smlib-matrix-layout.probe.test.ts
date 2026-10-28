/**
 * smlib applyMatrix 矩阵布局探针：SmApiTransformMatrixEx 桥期望的 12 元素布局。
 *
 * 两种候选：
 *  A. 行主序 4×4 前 12：[r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]（three.js 前 12）
 *  B. 旋转9 + 平移3：[r00..r22, tx,ty,tz]（bridge 代码行 3 = pM[9..11] 的读法）
 * 平移 [10,20,30]：A → bbox 平移 +[10,20,30]；B → 矩阵错乱。
 *
 * Run: Set-Location packages/core; npx vitest run test/smlib-kernel/smlib-matrix-layout.probe.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSmlibPrimitives, disposeSmlib, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { resetSmlibWasm } from '../../src/smlib-kernel/smlibWasm'

let p: SmlibPrimitives

beforeAll(async () => {
  p = await createSmlibPrimitives()
})
afterAll(() => {
  disposeSmlib()
  resetSmlibWasm()
})

function bbOf(h: unknown): string {
  const b = p.getBoundingBox(h as never)
  return `[${b.xmin.toFixed(1)},${b.ymin.toFixed(1)},${b.zmin.toFixed(1)}]-[${b.xmax.toFixed(1)},${b.ymax.toFixed(1)},${b.zmax.toFixed(1)}]`
}

describe('smlib transform 矩阵布局', () => {
  it('布局A（平移在 3,7,11）', () => {
    const box = p.makeBox(10, 10, 10)
    const t = p.transform(box, [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30])
    console.log(`[layout-A] bbox=${bbOf(t)}  (预期 [10,20,30]-[20,30,40])`)
    expect(bbOf(t)).toBe('[10.0,20.0,30.0]-[20.0,30.0,40.0]')
  })

  it('斜切旋转矩阵保形：R(z→[1,1,0]) 旋转 20³ 盒', () => {
    const n = { x: 1, y: 1, z: 0 }
    const len = Math.hypot(n.x, n.y, n.z)
    const nx = n.x / len, ny = n.y / len, nz = 0
    // axis = zAxis × n
    let ax = -ny, ay = nx, az = 0
    const sinA = Math.hypot(ax, ay, az)
    const cosA = nz // dot(zAxis,n) = n.z = 0
    const kx = ax / sinA, ky = ay / sinA, kz = az / sinA
    const K = [
      [0, -kz, ky],
      [kz, 0, -kx],
      [-ky, kx, 0],
    ]
    const R = new Array<number>(9)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let kk = 0
        for (let l = 0; l < 3; l++) kk += K[i][l] * K[l][j]
        R[i * 3 + j] = (i === j ? 1 : 0) + sinA * K[i][j] + (1 - cosA) * kk
      }
    }
    const m = [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0]
    const box = p.makeBox(20, 20, 20)
    const t = p.transform(box, m)
    console.log(`[rot-skew] R=[${R.map((v) => v.toFixed(3)).join(',')}]`)
    console.log(`[rot-skew] bbox=${bbOf(t)}  (纯旋转投影跨度：x/y≈34.6, z≈28.3)`)
    // 变换后的半空间盒（正半：local z∈[0,60]）直接打印 bbox
    const posBox = p.transform(p.makeBoxFromCorners({ x: -60, y: -60, z: 0 }, { x: 60, y: 60, z: 60 }), [R[0], R[1], R[2], 2, R[3], R[4], R[5], 3, R[6], R[7], R[8], 4])
    console.log(`[posbox] bbox=${bbOf(posBox)}`)
    // 差集：20³ − posBox
    const neg = p.cut(box, posBox)
    console.log(`[cut] neg bbox=${bbOf(neg)} vol=${p.getVolume(neg as never)}`)
  })
})
