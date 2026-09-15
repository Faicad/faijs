/**
 * probe-sprocket-nochamfer.ts — B 侧无倒角体积（隔离倒角差）。
 * 复刻 sprocket.ts 的链合成+拉伸，跳过倒角/孔。
 */
import { setupWarehouseKernel } from '../src/test-setup'
import { requireKernel } from '../src/kernel'
import { volumeOf, planarFace, wireFromEdges, extrudeFace, translate as translateShape } from '../src/primitives'
import { computeToothGeomForProbe, toothArcsForProbe } from '../src/sprocket'

async function main(): Promise<void> {
  await setupWarehouseKernel()
  requireKernel()
  const N = 16, cp = 12.7, rd = 7.9375, t = 0.084 * 25.4
  const geom = computeToothGeomForProbe(N, cp, rd / 2)
  const edges = []
  for (let k = 0; k < N; k++) {
    const ki = k === 0 ? 0 : N - k
    edges.push(...toothArcsForProbe(geom, 90 + ki * (360 / N)))
  }
  let solid = extrudeFace(planarFace(wireFromEdges(edges)), t)
  if (volumeOf(solid) < 0) solid = requireKernel().reverseShape(solid)
  solid = translateShape(solid, 0, 0, -t / 2)
  console.log(`B no-chamfer 16t = ${volumeOf(solid).toFixed(4)}  (A = 6590.2887)`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
