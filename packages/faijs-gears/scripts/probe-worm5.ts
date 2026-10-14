/**
 * probe-worm5.ts — 诊断右端平面 section 缺交线的原因
 * （左平面 section 完整、右平面只出 2 条边；试法向反转 + 递归提边 + common 对照）
 */
import type { BrepHandle } from '@faicad/faijs'
import { gearKernel } from '../src/kernel'
import { initOCCT } from '../src/test-setup'
import { wormGeometry } from '../src/profile'
import { buildWormToothFaces } from '../src/worm_gear'

function collectEdges(kernel: ReturnType<typeof gearKernel>, s: BrepHandle, out: BrepHandle[], depth = 0): void {
  const type = kernel.l1.shapeType(s)
  if (type === 'edge') { out.push(s); return }
  if (depth > 4) return
  for (const child of kernel.l1.getSubShapes(s, 'edge')) collectEdges(kernel, child, out, depth + 1)
  for (const child of kernel.l1.getSubShapes(s, 'wire')) collectEdges(kernel, child, out, depth + 1)
  for (const child of kernel.l1.getSubShapes(s, 'face')) collectEdges(kernel, child, out, depth + 1)
  for (const child of kernel.l1.getSubShapes(s, 'shell')) collectEdges(kernel, child, out, depth + 1)
}

async function main(): Promise<void> {
  await initOCCT()
  const kernel = gearKernel()
  const geom = wormGeometry({ module: 1.0, lead_angle: 20.0, n_threads: 1, length: 10.0 })

  const step = Math.PI * geom.m * geom.nThreads
  const turns = Math.ceil(geom.length / step) + 2
  const xStart = (-turns * step) / 2.0
  const tFaces = buildWormToothFaces(kernel, geom, 'grid-approx')
  const axisX = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }

  const nfaces = []
  for (let th = 0; th < geom.nThreads; th++) {
    const rot = th === 0 ? tFaces : tFaces.map((f) => kernel.l1.rotate(f, axisX, (Math.PI * 2) * th))
    for (let i = 0; i < turns; i++) {
      const dx = step / 2.0 + xStart + i * step
      for (const f of rot) nfaces.push(kernel.l1.translate(f, dx, 0, 0))
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
    const edges = pts.map((p, i) => kernel.l1.makeLineEdge(p, pts[(i + 1) % 4]))
    return kernel.l1.makeFace(kernel.l1.makeWire(edges))
  }

  // 只对「右端跨界」的面做 section（dx=4.712 那组），比较四种做法
  const straddle = nfaces.filter((f) => {
    const bb = kernel.l1.getBoundingBox(f)
    return bb.xmax > cpX && bb.xmin < cpX
  })
  console.log('right-straddle faces:', straddle.length)

  for (const flip of [false, true]) {
    // L1 中立名 `sectionByPlane`：法向 ±X 就是旧写法里手工反转顶点序换来的那两种
    // 平面定向（`flip`）。
    const normal = { x: flip ? -1 : 1, y: 0, z: 0 }
    let total = 0
    const lens: number[] = []
    for (const f of straddle) {
      const edges: BrepHandle[] = []
      for (const s of kernel.l1.sectionByPlane(f, { x: cpX, y: 0, z: 0 }, normal)) {
        collectEdges(kernel, s, edges)
      }
      total += edges.length
      lens.push(edges.length)
    }
    console.log(`section flip=${flip}: edges per face = [${lens.join(',')}] total=${total}`)
  }

  // common 对照（交集体 → 应为含切边的面片）
  const plane = cutPlaneAt(cpX, false)
  for (let i = 0; i < straddle.length; i++) {
    const cm = kernel.l1.common(straddle[i], plane)
    const edges: BrepHandle[] = []
    collectEdges(kernel, cm, edges)
    console.log(`common[${i}] type=${kernel.l1.shapeType(cm)} edges=${edges.length}`)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
