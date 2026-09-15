/**
 * probe-chamfer-ts.ts — B 侧对照：内核 chamferDistAngle 能否复现 cq 非对称倒角。
 *
 * A 侧（probe-chamfer-a.py）：R=10/r=5/H=2 圆环，外顶圆 chamfer(0.5, 1.0)。
 * 本脚本用同一几何试两种参数化：
 *   ① F=顶面假设：AddDA(0.5, atan2(1.0, 0.5))
 *   ② F=侧面假设：AddDA(1.0, atan2(0.5, 1.0))
 * 哪种体积与 A 侧 removed 一致，sprocket.ts 就用哪种参数化。
 */
import { setupWarehouseKernel } from '../src/test-setup'
import { requireKernel } from '../src/kernel'

async function main(): Promise<void> {
  await setupWarehouseKernel()
  const k = requireKernel()
  const R = 10.0, r = 5.0, H = 2.0
  const outer = k.makeCylinder(R, H)
  const inner = k.makeCylinder(r, H)
  const ring = k.cut(outer, inner)
  const v0 = k.getVolume(ring)
  // 找外顶圆边：CIRCLE + 半径 R + z==H
  const edges = k.getSubShapes(ring, 'edge')
  const picked: unknown[] = []
  for (const e of edges) {
    if (k.curveType(e) !== 'CIRCLE') continue
    const vs = k.getSubShapes(e, 'vertex')
    const zs = vs.map((v) => k.vertexPosition(v).z)
    const rad = Math.hypot(k.curvePointAtParam(e, k.curveParameters(e).first ?? 0).x,
      k.curvePointAtParam(e, k.curveParameters(e).first ?? 0).y)
    if (Math.abs(rad - R) < 1e-6 && Math.abs(Math.max(...zs) - H) < 1e-6) picked.push(e)
  }
  console.log(`picked ${picked.length} outer-top edge(s), unchamfered=${v0.toFixed(9)}`)
  for (const [tag, d, angDeg] of [
    ['F=top   ', 0.5, Math.atan2(1.0, 0.5) * 180 / Math.PI],
    ['F=side  ', 1.0, Math.atan2(0.5, 1.0) * 180 / Math.PI],
  ] as const) {
    try {
      const ch = k.chamferDistAngle(ring, picked as never, d, angDeg)
      const v1 = k.getVolume(ch)
      console.log(`${tag} d=${d} ang=${angDeg.toFixed(3)} chamfered=${v1.toFixed(9)} removed=${(v0 - v1).toFixed(9)}`)
    } catch (e) {
      console.log(`${tag} FAILED: ${(e as Error).message}`)
    }
  }
  console.log('A-side removed = 5.235937943 (probe-chamfer-a.py)')
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
