/**
 * probe-worm4.ts — 定位 Worm 壳不封闭的自由边（只被一个面使用的边）
 */
import { gearKernel } from '../src/kernel'
import { initOCCT } from '../src/test-setup'
import { wormGeometry } from '../src/profile'
import { buildWormGearFaces } from '../src/worm_gear'

async function main(): Promise<void> {
  await initOCCT()
  const kernel = gearKernel()
  const geom = wormGeometry({ module: 1.0, lead_angle: 20.0, n_threads: 1, length: 10.0 })
  const faces = buildWormGearFaces(kernel, geom, 'grid-approx')
  console.log('total faces:', faces.length)

  // 统计每条边被多少个面使用
  const use = new Map<string, { n: number; edge: number; bb: ReturnType<typeof kernel.l1.getBoundingBox> }>()
  for (let fi = 0; fi < faces.length; fi++) {
    for (const e of kernel.l1.getSubShapes(faces[fi], 'edge')) {
      const key = `${kernel.l1.hashCode(e, 2147483647)}`
      const rec = use.get(key)
      if (rec) rec.n++
      else use.set(key, { n: 1, edge: fi, bb: kernel.l1.getBoundingBox(e) })
    }
  }
  let free = 0
  for (const { n, edge, bb } of use.values()) {
    if (n === 1) {
      free++
      console.log(
        `FREE edge on face[${edge}] x=[${bb.xmin.toFixed(4)},${bb.xmax.toFixed(4)}] ` +
        `y=[${bb.ymin.toFixed(4)},${bb.ymax.toFixed(4)}] z=[${bb.zmin.toFixed(4)},${bb.zmax.toFixed(4)}]`,
      )
    }
  }
  console.log('free edges:', free)

  const shell = kernel.l1.sew(faces, 0.01)
  console.log('sew →', kernel.l1.shapeType(shell), '| faces:', kernel.l1.subShapeCount(shell, 'face'))
  const solid = kernel.l1.makeSolid(shell)
  console.log('makeSolid →', kernel.l1.shapeType(solid), '| vol:', kernel.l1.isSolid(solid) ? kernel.l1.getVolume(solid).toFixed(4) : 'n/a')
}

main().catch((err) => { console.error(err); process.exit(1) })
