/**
 * probe-worm3.ts — 诊断 grid-approx 下 Worm 端盖两条 wire 的形态与 sew 结果
 */
import { getGearKernel } from '@faicad/cq-compat'
import { wormGeometry } from '../src/profile'
import { buildWormToothFaces } from '../src/worm_gear'
import { connectEdgesToWires } from '../src/geom-build'

async function main(): Promise<void> {
  const kernel = await getGearKernel()
  const geom = wormGeometry({ module: 1.0, lead_angle: 20.0, n_threads: 1, length: 10.0 })

  const step = Math.PI * geom.m * geom.nThreads
  const turns = Math.ceil(geom.length / step) + 2
  const xStart = (-turns * step) / 2.0
  const tFaces = buildWormToothFaces(kernel, geom, 'grid-approx')
  const axisX = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }
  const tau = (Math.PI * 2.0) / geom.nThreads

  const nfaces = []
  for (let th = 0; th < geom.nThreads; th++) {
    const rot = th === 0 ? tFaces : tFaces.map((f) => kernel.rotate(f, axisX, tau * th))
    for (let i = 0; i < turns; i++) {
      const dx = step / 2.0 + xStart + i * step
      for (const f of rot) nfaces.push(kernel.translate(f, dx, 0, 0))
    }
  }

  const half = geom.ra + 1.0
  const cpX = geom.length / 2
  const cutPlaneAt = (x: number) => {
    const c = { x, y: -half, z: -half }
    const edges = [
      kernel.makeLineEdge(c, { x, y: half, z: -half }),
      kernel.makeLineEdge({ x, y: half, z: -half }, { x, y: half, z: half }),
      kernel.makeLineEdge({ x, y: half, z: half }, { x, y: -half, z: half }),
      kernel.makeLineEdge({ x, y: -half, z: half }, c),
    ]
    return kernel.makeFace(kernel.makeWire(edges))
  }
  const leftPlane = cutPlaneAt(-cpX)

  // 修剪（复刻 worm_gear.ts 当前逻辑）
  const gFaces = []
  for (const face of nfaces) {
    const bb = kernel.getBoundingBox(face)
    if (bb.xmin > -cpX && bb.xmax < cpX) { gFaces.push(face); continue }
    if (bb.xmin < -cpX && bb.xmax > -cpX) {
      const pieces = kernel.getSubShapes(kernel.split(face, [leftPlane]), 'face')
      let best; let bestX = -Infinity
      for (const p of pieces) {
        const x = kernel.getBoundingBox(p).xmax
        if (x > bestX) { bestX = x; best = p }
      }
      if (best) gFaces.push(best)
    } else if (bb.xmax > cpX && bb.xmin < cpX) {
      // 右端用对称平面
      const rightPlane = cutPlaneAt(cpX)
      const pieces = kernel.getSubShapes(kernel.split(face, [rightPlane]), 'face')
      let best; let bestX = Infinity
      for (const p of pieces) {
        const x = kernel.getBoundingBox(p).xmin
        if (x < bestX) { bestX = x; best = p }
      }
      if (best) gFaces.push(best)
    }
  }
  console.log('g_faces (before caps):', gFaces.length)

  // 端盖 section
  for (const [plane, x] of [[leftPlane, -cpX], [cutPlaneAt(cpX), cpX]] as const) {
    const edges = []
    for (const f of nfaces) {
      const sec = kernel.section(f, plane)
      for (const e of kernel.getSubShapes(sec, 'edge')) edges.push(e)
    }
    const wires = connectEdgesToWires(kernel, edges, 0.1)
    console.log(`x=${x}: ${edges.length} edges → ${wires.length} wires`)
    wires.forEach((w, i) => {
      const bb = kernel.getBoundingBox(w)
      const ne = kernel.subShapeCount(w, 'edge')
      console.log(`  wire[${i}] edges=${ne} y=[${bb.ymin.toFixed(4)},${bb.ymax.toFixed(4)}] z=[${bb.zmin.toFixed(4)},${bb.zmax.toFixed(4)}] area≈${((bb.ymax - bb.ymin) * (bb.zmax - bb.zmin)).toFixed(4)}`)
      const face = kernel.makeFace(kernel.healWire(w, 0.1))
      console.log(`    face valid=${kernel.isFace(face)} area=${kernel.getSurfaceArea(face).toFixed(4)}`)
    })
  }

  // sew 尝试：分别用最大环 cap
  const shell = kernel.sew([...gFaces], 0.01)
  console.log('sew g_faces only:', kernel.getShapeType(shell), 'closed?', kernel.subShapeCount(shell, 'face'), 'faces')
}

main().catch((err) => { console.error(err); process.exit(1) })
