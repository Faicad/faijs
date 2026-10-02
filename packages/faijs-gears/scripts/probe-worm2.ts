/**
 * probe-worm2.ts — 诊断 Worm 端盖 section 边的端点间隙（为何组不成一条闭环）
 */
import { getGearKernel } from '@faicad/cq-compat'
import { wormGeometry } from '../src/profile'
import { buildWormToothFaces } from '../src/worm_gear'

async function main(): Promise<void> {
  const kernel = await getGearKernel()
  const geom = wormGeometry({ module: 1.0, lead_angle: 20.0, n_threads: 1, length: 10.0 })

  const step = Math.PI * geom.m * geom.nThreads
  const turns = Math.ceil(geom.length / step) + 2
  const xStart = (-turns * step) / 2.0
  const tFaces = buildWormToothFaces(kernel, geom, 'row-approx-loft')
  const axisX = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }

  const nfaces = []
  for (let th = 0; th < geom.nThreads; th++) {
    const rot = th === 0 ? tFaces : tFaces.map((f) => kernel.rotate(f, axisX, tauOf(geom.nThreads) * th))
    for (let i = 0; i < turns; i++) {
      const dx = step / 2.0 + xStart + i * step
      for (const f of rot) nfaces.push(kernel.translate(f, dx, 0, 0))
    }
  }

  const half = geom.ra + 1.0
  const cpX = geom.length / 2
  const plane = (() => {
    const c = { x: -cpX, y: -half, z: -half }
    const edges = [
      kernel.makeLineEdge(c, { x: -cpX, y: half, z: -half }),
      kernel.makeLineEdge({ x: -cpX, y: half, z: -half }, { x: -cpX, y: half, z: half }),
      kernel.makeLineEdge({ x: -cpX, y: half, z: half }, { x: -cpX, y: -half, z: half }),
      kernel.makeLineEdge({ x: -cpX, y: -half, z: half }, c),
    ]
    return kernel.makeFace(kernel.makeWire(edges))
  })()

  const allEdges = []
  for (let i = 0; i < nfaces.length; i++) {
    const sec = kernel.section(nfaces[i], plane)
    const es = kernel.getSubShapes(sec, 'edge')
    if (es.length > 0) console.log(`face[${i}] → ${es.length} edge(s)`)
    for (const e of es) allEdges.push(e)
  }
  console.log(`total section edges: ${allEdges.length}`)

  const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

  const ends = allEdges.map((e, i) => {
    const { first, last } = kernel.curveParameters(e)
    const a = kernel.curvePointAtParam(e, first)
    const b = kernel.curvePointAtParam(e, last)
    return { i, a, b }
  })
  for (const { i, a, b } of ends) {
    console.log(`edge[${i}] A=(${a.x.toFixed(4)},${a.y.toFixed(4)},${a.z.toFixed(4)}) B=(${b.x.toFixed(4)},${b.y.toFixed(4)},${b.z.toFixed(4)})`)
  }
  // 最近邻间隙矩阵
  console.log('--- pairwise endpoint gaps (< 1.0) ---')
  for (let i = 0; i < ends.length; i++) {
    for (let j = 0; j < ends.length; j++) {
      if (i === j) continue
      const pairs = [
        [ends[i].a, ends[j].a], [ends[i].a, ends[j].b],
        [ends[i].b, ends[j].a], [ends[i].b, ends[j].b],
      ]
      for (const [p, q] of pairs) {
        const d = dist(p, q)
        if (d < 1.0) console.log(`edge[${i}]↔edge[${j}] gap=${d.toFixed(5)}`)
      }
    }
  }
}

function tauOf(n: number): number {
  return (Math.PI * 2) / n
}

main().catch((err) => { console.error(err); process.exit(1) })
