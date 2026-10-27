/**
 * 临时探针 v2：4 直线 + n 弧交替闭环构面临界（SM 1001 定位，精简版）。
 */
import { createSmlibPrimitives } from '../src/smlib-kernel/smlibKernel'

async function main() {
  const prim = await createSmlibPrimitives()
  const p = (x: number, y: number, z: number) => ({ x, y, z })
  const lines = [
    prim.makeLineEdge(p(-3, -4, 0), p(3, -4, 0)),
    prim.makeLineEdge(p(5, -2, 0), p(5, 2, 0)),
    prim.makeLineEdge(p(3, 4, 0), p(-3, 4, 0)),
    prim.makeLineEdge(p(-5, 2, 0), p(-5, -2, 0)),
  ]
  const arcs = [
    prim.makeArcEdge(p(3, -4, 0), p(4.41421356, -3.41421356, 0), p(5, -2, 0)),
    prim.makeArcEdge(p(5, 2, 0), p(4.41421356, 3.41421356, 0), p(3, 4, 0)),
    prim.makeArcEdge(p(-3, 4, 0), p(-4.41421356, 3.41421356, 0), p(-5, 2, 0)),
    prim.makeArcEdge(p(-5, -2, 0), p(-4.41421356, -3.41421356, 0), p(-3, -4, 0)),
  ]
  // 独立 4 直线环
  try {
    const f0 = prim.makeFace(prim.makeWire(lines))
    console.log('f0(4 lines)=OK')
  } catch (e) {
    console.log('f0(4 lines)=FAIL', (e as Error).message)
  }
  // 1..4 弧交替
  for (let n = 1; n <= 4; n++) {
    const combo: unknown[] = []
    for (let i = 0; i < 4; i++) {
      combo.push(lines[i])
      if (i < n) combo.push(arcs[i])
    }
    try {
      const f = prim.makeFace(prim.makeWire(combo as never))
      console.log(`combo(n=${n} arcs)=OK`)
    } catch (e) {
      console.log(`combo(n=${n} arcs)=FAIL`, (e as Error).message)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
