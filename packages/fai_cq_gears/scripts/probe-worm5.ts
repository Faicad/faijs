/**
 * probe-worm5.ts — 诊断右端平面 section 缺交线的原因
 * （左平面 section 完整、右平面只出 2 条边；试法向反转 + 递归提边 + common 对照）
 */
import type { BrepHandle } from '@faicad/faijs-core'
import { getRawKernel } from '../src/kernel'
import { wormGeometry } from '../src/profile'
import { buildWormToothFaces } from '../src/worm_gear'

function collectEdges(kernel: ReturnType<typeof getRawKernel> extends Promise<infer K> ? K : never, s: BrepHandle, out: BrepHandle[], depth = 0): void {
  const type = kernel.getShapeType(s)
  if (type === 'edge') { out.push(s); return }
  if (depth > 4) return
  for (const child of kernel.getSubShapes(s, 'edge')) collectEdges(kernel, child, out, depth + 1)
  for (const child of kernel.getSubShapes(s, 'wire')) collectEdges(kernel, child, out, depth + 1)
  for (const child of kernel.getSubShapes(s, 'face')) collectEdges(kernel, child, out, depth + 1)
  for (const child of kernel.getSubShapes(s, 'shell')) collectEdges(kernel, child, out, depth + 1)
}

async function main(): Promise<void> {
  const kernel = await getRawKernel()
  const geom = wormGeometry({ module: 1.0, lead_angle: 20.0, n_threads: 1, length: 10.0 })

  const step = Math.PI * geom.m * geom.nThreads
  const turns = Math.ceil(geom.length / step) + 2
  const xStart = (-turns * step) / 2.0
  const tFaces = buildWormToothFaces(kernel, geom, 'grid-approx')
  const axisX = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }

  const nfaces = []
  for (let th = 0; th < geom.nThreads; th++) {
    const rot = th === 0 ? tFaces : tFaces.map((f) => kernel.rotate(f, axisX, (Math.PI * 2) * th))
    for (let i = 0; i < turns; i++) {
      const dx = step / 2.0 + xStart + i * step
      for (const f of rot) nfaces.push(kernel.translate(f, dx, 0, 0))
    }
  }

  const half = geom.ra + 1.0
  const cpX = geom.length / 2
  // winding 参数控制顶点顺序（影响面法向 ±x）
  const cutPlaneAt = (x: number, flip: boolean) => {
    const pts = [
      { x, y: -half, z: -half }, { x, y: half, z: -half },
      { x, y: half, z: half }, { x, y: -half, z: half },
    ]
    if (flip) pts.reverse()
    const edges = pts.map((p, i) => kernel.makeLineEdge(p, pts[(i + 1) % 4]))
    return kernel.makeFace(kernel.makeWire(edges))
  }

  // 只对「右端跨界」的面做 section（dx=4.712 那组），比较四种做法
  const straddle = nfaces.filter((f) => {
    const bb = kernel.getBoundingBox(f)
    return bb.xmax > cpX && bb.xmin < cpX
  })
  console.log('right-straddle faces:', straddle.length)

  for (const flip of [false, true]) {
    const plane = cutPlaneAt(cpX, flip)
    let total = 0
    const lens: number[] = []
    for (const f of straddle) {
      const sec = kernel.section(f, plane)
      const edges: BrepHandle[] = []
      collectEdges(kernel, sec, edges)
      total += edges.length
      lens.push(edges.length)
    }
    console.log(`section flip=${flip}: edges per face = [${lens.join(',')}] total=${total}`)
  }

  // common 对照（交集体 → 应为含切边的面片）
  const plane = cutPlaneAt(cpX, false)
  for (let i = 0; i < straddle.length; i++) {
    const cm = kernel.common(straddle[i], plane)
    const edges: BrepHandle[] = []
    collectEdges(kernel, cm, edges)
    console.log(`common[${i}] type=${kernel.getShapeType(cm)} edges=${edges.length}`)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
