/**
 * probe-worm3.ts — 诊断 grid-approx 下 Worm 端盖两条 wire 的形态与 sew 结果
 */
import { gearIsFace, gearKernel } from '../src/kernel'
import { initOCCT } from '../src/test-setup'
import { wormGeometry } from '../src/profile'
import { buildWormToothFaces } from '../src/worm_gear'
import { connectEdgesToWires } from '../src/kernel'

async function main(): Promise<void> {
  await initOCCT()
  const kernel = gearKernel()
  const geom = wormGeometry({ module: 1.0, lead_angle: 20.0, n_threads: 1, length: 10.0 })

  const step = Math.PI * geom.m * geom.nThreads
  const turns = Math.ceil(geom.length / step) + 2
  const xStart = (-turns * step) / 2.0
  const tFaces = buildWormToothFaces(kernel, geom, 'grid-approx')
  const axisX = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }
  const tau = (Math.PI * 2.0) / geom.nThreads

  const nfaces = []
  for (let th = 0; th < geom.nThreads; th++) {
    const rot = th === 0 ? tFaces : tFaces.map((f) => kernel.l1.rotate(f, axisX, tau * th))
    for (let i = 0; i < turns; i++) {
      const dx = step / 2.0 + xStart + i * step
      for (const f of rot) nfaces.push(kernel.l1.translate(f, dx, 0, 0))
    }
  }

  const half = geom.ra + 1.0
  const cpX = geom.length / 2
  const cutPlaneAt = (x: number) => {
    const c = { x, y: -half, z: -half }
    const edges = [
      kernel.l1.makeLineEdge(c, { x, y: half, z: -half }),
      kernel.l1.makeLineEdge({ x, y: half, z: -half }, { x, y: half, z: half }),
      kernel.l1.makeLineEdge({ x, y: half, z: half }, { x, y: -half, z: half }),
      kernel.l1.makeLineEdge({ x, y: -half, z: half }, c),
    ]
    return kernel.l1.makeFace(kernel.l1.makeWire(edges))
  }
  const leftPlane = cutPlaneAt(-cpX)

  // 修剪（复刻 worm_gear.ts 当前逻辑）
  const gFaces = []
  for (const face of nfaces) {
    const bb = kernel.l1.getBoundingBox(face)
    if (bb.xmin > -cpX && bb.xmax < cpX) { gFaces.push(face); continue }
    if (bb.xmin < -cpX && bb.xmax > -cpX) {
      const pieces = kernel.l1.getSubShapes(kernel.occt.split(face, [leftPlane]), 'face')
      let best; let bestX = -Infinity
      for (const p of pieces) {
        const x = kernel.l1.getBoundingBox(p).xmax
        if (x > bestX) { bestX = x; best = p }
      }
      if (best) gFaces.push(best)
    } else if (bb.xmax > cpX && bb.xmin < cpX) {
      // 右端用对称平面
      const rightPlane = cutPlaneAt(cpX)
      const pieces = kernel.l1.getSubShapes(kernel.occt.split(face, [rightPlane]), 'face')
      let best; let bestX = Infinity
      for (const p of pieces) {
        const x = kernel.l1.getBoundingBox(p).xmin
        if (x < bestX) { bestX = x; best = p }
      }
      if (best) gFaces.push(best)
    }
  }
  console.log('g_faces (before caps):', gFaces.length)

  // 端盖 section（走 L1 中立名 `sectionByPlane`；`leftPlane`/`cutPlaneAt` 仍供上面的
  // 修剪用，这里只需要「过 x 的 ±X 法向平面」这一层信息）
  for (const x of [-cpX, cpX] as const) {
    const edges = []
    for (const f of nfaces) {
      for (const s of kernel.l1.sectionByPlane(f, { x, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })) {
        if (kernel.l1.shapeType(s) === 'edge') edges.push(s)
      }
    }
    const wires = connectEdgesToWires(kernel, edges, 0.1)
    console.log(`x=${x}: ${edges.length} edges → ${wires.length} wires`)
    wires.forEach((w, i) => {
      const bb = kernel.l1.getBoundingBox(w)
      const ne = kernel.l1.subShapeCount(w, 'edge')
      console.log(`  wire[${i}] edges=${ne} y=[${bb.ymin.toFixed(4)},${bb.ymax.toFixed(4)}] z=[${bb.zmin.toFixed(4)},${bb.zmax.toFixed(4)}] area≈${((bb.ymax - bb.ymin) * (bb.zmax - bb.zmin)).toFixed(4)}`)
      const face = kernel.l1.makeFace(kernel.occt.healWire(w, 0.1))
      console.log(`    face valid=${gearIsFace(kernel, face)} area=${kernel.l1.getSurfaceArea(face).toFixed(4)}`)
    })
  }

  // sew 尝试：分别用最大环 cap
  const shell = kernel.l1.sew([...gFaces], 0.01)
  console.log('sew g_faces only:', kernel.l1.shapeType(shell), 'closed?', kernel.l1.subShapeCount(shell, 'face'), 'faces')
}

main().catch((err) => { console.error(err); process.exit(1) })
