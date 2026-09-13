/**
 * probe-worm.ts — 诊断 Worm 端盖组线：x=±length/2 处收集到的边 / wire 形态
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
  const tau = (Math.PI * 2.0) / geom.nThreads
  const tFaces = buildWormToothFaces(kernel, geom, 'grid-approx')
  const axisX = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }

  const nfaces = []
  for (let th = 0; th < geom.nThreads; th++) {
    const rot = th === 0 ? tFaces : tFaces.map((f) => kernel.rotate(f, axisX, tau * th))
    for (let i = 0; i < turns; i++) {
      const dx = step / 2.0 + xStart + i * step
      for (const f of rot) nfaces.push(kernel.translate(f, dx, 0, 0))
    }
  }
  console.log('nfaces:', nfaces.length)

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

  // 逐面检查 bbox 与 split 行为
  for (let i = 0; i < nfaces.length; i++) {
    const bb = kernel.getBoundingBox(nfaces[i])
    const straddles = bb.xmin < -cpX
    console.log(
      `face[${i}] x=[${bb.xmin.toFixed(3)},${bb.xmax.toFixed(3)}]` +
      (straddles ? ' LEFT-STRADDLE' : '') + (bb.xmax > cpX ? ' RIGHT-STRADDLE' : ''),
    )
    if (straddles) {
      const split = kernel.split(nfaces[i], [leftPlane])
      const kind = kernel.getShapeType(split)
      const pieces = kernel.getSubShapes(split, 'face')
      console.log(`  split → ${kind}, ${pieces.length} pieces`)
      for (const p of pieces) {
        const pb = kernel.getBoundingBox(p)
        console.log(`    piece x=[${pb.xmin.toFixed(3)},${pb.xmax.toFixed(3)}]`)
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
