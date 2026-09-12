/**
 * probe-rack — RackGear 移植前的内核行为探查（一次性）
 *
 * ① approximatePoints 对 2 点列的行为（rack 齿廓每段只有 2 个点）
 * ② kernel.split：面被相交/不相交平面切分的返回形态（决定裁剪分支）
 * ③ 4 角点平行四边形 loft vs makeFace 的平面性
 *
 * 用法：node ../../node_modules/tsx/dist/cli.mjs scripts/probe-rack.ts
 */

import { getRawKernel } from '../src/kernel'
import { buildSplineFace } from '../src/spline-face'
import type { ToothGrid } from '../src/profile'
import type { Vec3 } from '../src/math'

async function main(): Promise<void> {
  const kernel = await getRawKernel()

  // ① 2 点列 approximatePoints
  const two: Vec3[] = [
    { x: -1.2403609562302012, y: -1.25, z: 0 },
    { x: -0.42142792913124594, y: 1, z: 0 },
  ]
  try {
    const c = kernel.approximatePoints(two, 1e-2)
    const w = kernel.makeWire([c])
    console.log(`① approximatePoints(2pts): ok, wire closed=${kernel.curveIsClosed(c)} bb=${JSON.stringify(kernel.getBoundingBox(c))}`)
    const f = kernel.makeFace(w)
    console.log(`   makeFace(wire): type=${kernel.getShapeType(f)} area=${kernel.getSurfaceArea(f).toFixed(6)}`)
  } catch (e) {
    console.log(`① approximatePoints(2pts): THREW ${String(e)}`)
  }

  // ② split 行为：矩形面 + 平面工具
  const rect = (x0: number, x1: number): BrepHandle2 => {
    const p = (x: number, y: number) => ({ x, y, z: 0 })
    const es = [
      kernel.makeLineEdge(p(x0, -1), p(x1, -1)),
      kernel.makeLineEdge(p(x1, -1), p(x1, 1)),
      kernel.makeLineEdge(p(x1, 1), p(x0, 1)),
      kernel.makeLineEdge(p(x0, 1), p(x0, -1)),
    ]
    return kernel.makeFace(kernel.makeWire(es))
  }
  type BrepHandle2 = ReturnType<typeof kernel.makeFace>

  const faceCross = rect(-1, 1) // 与 x=0 平面相交
  const planeTool = (() => {
    // x=0 平面上的大矩形（y-z 平面）
    const c = (y: number, z: number) => ({ x: 0, y, z })
    const es = [
      kernel.makeLineEdge(c(-20, -20), c(20, -20)),
      kernel.makeLineEdge(c(20, -20), c(20, 20)),
      kernel.makeLineEdge(c(20, 20), c(-20, 20)),
      kernel.makeLineEdge(c(-20, 20), c(-20, -20)),
    ]
    return kernel.makeFace(kernel.makeWire(es))
  })()

  const splitCross = kernel.split(faceCross, [planeTool])
  const crossFaces = kernel.isFace(splitCross) ? [splitCross] : kernel.getSubShapes(splitCross, 'face')
  console.log(`② split(相交): type=${kernel.getShapeType(splitCross)} fragments=${crossFaces.length}`)
  for (const f of crossFaces) console.log(`   frag bb.x=[${kernel.getBoundingBox(f).xmin.toFixed(3)},${kernel.getBoundingBox(f).xmax.toFixed(3)}]`)

  const faceAway = rect(3, 5) // 与 x=0 平面不相交
  const splitAway = kernel.split(faceAway, [planeTool])
  const awayFaces = kernel.isFace(splitAway) ? [splitAway] : kernel.getSubShapes(splitAway, 'face')
  console.log(`② split(不相交): type=${kernel.getShapeType(splitAway)} fragments=${awayFaces.length}`)
  for (const f of awayFaces) console.log(`   frag bb.x=[${kernel.getBoundingBox(f).xmin.toFixed(3)},${kernel.getBoundingBox(f).xmax.toFixed(3)}]`)

  // ③ 2×2 点阵（平行四边形）走 spline-face 三方案
  const grid: ToothGrid = {
    segment: 'lflank',
    rows: 2,
    cols: 2,
    points: [
      [{ x: -1.24, y: -1.25, z: 0 }, { x: -0.42, y: 1, z: 0 }],
      [{ x: -0.24, y: -1.25, z: 10 }, { x: 0.58, y: 1, z: 10 }],
    ],
  }
  for (const s of ['grid-approx', 'row-approx-loft', 'row-interp-loft'] as const) {
    try {
      const f = buildSplineFace(kernel, grid, s)
      console.log(`③ ${s}: type=${kernel.getShapeType(f)} area=${kernel.getSurfaceArea(f).toFixed(6)} valid=${kernel.isValid(f)}`)
    } catch (e) {
      console.log(`③ ${s}: THREW ${String(e)}`)
    }
  }
  // 平行四边形精确面积参考
  console.log(`③ 精确平行四边形面积 = ${(Math.hypot(0.82, 2.25) * 10).toFixed(6)}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
