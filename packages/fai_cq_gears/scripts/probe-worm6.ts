/**
 * probe-worm6.ts — 右端盖边界边的端点坐标与组线行为（按容差扫描）
 * 输出写 stdout，由调用方重定向到文件读取，避免工具截断。
 */
import type { BrepHandle } from '@faicad/faijs-core'
import { getRawKernel } from '../src/kernel'
import { wormGeometry } from '../src/profile'
import { buildWormToothFaces } from '../src/worm_gear'
import { connectEdgesToWires } from '../src/geom-build'

async function main(): Promise<void> {
  const kernel = await getRawKernel()
  const geom = wormGeometry({ module: 1.0, lead_angle: 20.0, n_threads: 1, length: 10.0 })

  const step = Math.PI * geom.m * geom.nThreads
  const turns = Math.ceil(geom.length / step) + 2
  const xStart = (-turns * step) / 2.0
  const tFaces = buildWormToothFaces(kernel, geom, 'grid-approx')
  const axisX = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }

  const nfaces: BrepHandle[] = []
  for (let th = 0; th < geom.nThreads; th++) {
    const rot = th === 0 ? tFaces : tFaces.map((f) => kernel.rotate(f, axisX, (Math.PI * 2) * th))
    for (let i = 0; i < turns; i++) {
      const dx = step / 2.0 + xStart + i * step
      for (const f of rot) nfaces.push(kernel.translate(f, dx, 0, 0))
    }
  }

  const half = geom.ra + 1.0
  const cpX = geom.length / 2
  const cutPlaneAt = (x: number) => {
    const c = { x, y: -half, z: -half }
    const es = [
      kernel.makeLineEdge(c, { x, y: half, z: -half }),
      kernel.makeLineEdge({ x, y: half, z: -half }, { x, y: half, z: half }),
      kernel.makeLineEdge({ x, y: half, z: half }, { x, y: -half, z: half }),
      kernel.makeLineEdge({ x, y: -half, z: half }, c),
    ]
    return kernel.makeFace(kernel.makeWire(es))
  }

  // 复刻 worm_gear.ts 的修剪
  const gFaces: BrepHandle[] = []
  for (const face of nfaces) {
    const bb = kernel.getBoundingBox(face)
    if (bb.xmin > -cpX && bb.xmax < cpX) { gFaces.push(face); continue }
    if (bb.xmin < -cpX && bb.xmax > -cpX) {
      const pieces = kernel.getSubShapes(kernel.split(face, [cutPlaneAt(-cpX)]), 'face')
      let best: BrepHandle | undefined
      let bestX = -Infinity
      for (const p of pieces) {
        const x = kernel.getBoundingBox(p).xmax
        if (x > bestX) { bestX = x; best = p }
      }
      if (best) gFaces.push(best)
    } else if (bb.xmax > cpX && bb.xmin < cpX) {
      const pieces = kernel.getSubShapes(kernel.split(face, [cutPlaneAt(cpX)]), 'face')
      let best: BrepHandle | undefined
      let bestX = Infinity
      for (const p of pieces) {
        const x = kernel.getBoundingBox(p).xmin
        if (x < bestX) { bestX = x; best = p }
      }
      if (best) gFaces.push(best)
    }
  }

  for (const x of [-cpX, cpX]) {
    const edges: BrepHandle[] = []
    for (const f of gFaces) {
      for (const e of kernel.getSubShapes(f, 'edge')) {
        const bb = kernel.getBoundingBox(e)
        if (Math.abs(bb.xmin - x) <= 1e-6 && Math.abs(bb.xmax - x) <= 1e-6) edges.push(e)
      }
    }
    console.log(`\n=== x=${x}: ${edges.length} planar edges ===`)
    const pts = edges.map((e) => {
      const { first, last } = kernel.curveParameters(e)
      return { a: kernel.curvePointAtParam(e, first), b: kernel.curvePointAtParam(e, last) }
    })
    pts.forEach(({ a, b }, i) => {
      console.log(`edge[${i}] A=(${a.x.toFixed(4)},${a.y.toFixed(4)},${a.z.toFixed(4)}) B=(${b.x.toFixed(4)},${b.y.toFixed(4)},${b.z.toFixed(4)})`)
    })
    for (const tol of [0.01, 0.05, 0.1, 0.2]) {
      const wires = connectEdgesToWires(kernel, edges, tol)
      const sizes = wires.map((w) => kernel.subShapeCount(w, 'edge'))
      console.log(`tol=${tol}: ${wires.length} wires, edges/wire=[${sizes.join(',')}]`)
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
