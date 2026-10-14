/**
 * probe-window.ts — 对比 TS 侧轮辐窗口面面积与 cq 基准
 *
 * cq 基准（cadquery-env python，radiusArc 路径）：
 *   n=5 sw=3  id=16 od=32 → 96.563698
 *   n=3 sw=8  id=16 od=32 → 135.627591
 *   n=3 sw=20 id=40 od=100 → 1588.455195
 */
import { gearKernel } from '../src/kernel'
import { initOCCT } from '../src/test-setup'

async function main(): Promise<void> {
  await initOCCT()
  const kernel = gearKernel()
  const cases: Array<[number, number, number, number]> = [
    [5, 3, 16, 32],
    [3, 8, 16, 32],
    [3, 20, 40, 100],
  ]
  for (const [n, sw, idd, od] of cases) {
    const r1 = Math.max(sw / 2, idd / 2) + 1e-4
    const r2 = od / 2 - 1e-4
    const tau = (Math.PI * 2) / n
    const a1 = Math.asin((sw / 2) / (idd / 2))
    const a2 = Math.asin((sw / 2) / (od / 2))
    const a3 = tau - a2
    const a4 = tau - a1
    const pt = (r: number, ang: number) => ({ x: Math.cos(ang) * r, y: Math.sin(ang) * r, z: 0 })
    const p1 = pt(r1, a1)
    const p2 = pt(r2, a2)
    const p3 = pt(r2, a3)
    const p4 = pt(r1, a4)
    const edges = [
      kernel.l1.makeLineEdge(p1, p2),
      kernel.l1.makeArcEdge(p2, pt(r2, (a2 + a3) / 2), p3),
      kernel.l1.makeLineEdge(p3, p4),
      kernel.l1.makeArcEdge(p4, pt(r1, (a1 + a4) / 2), p1),
    ]
    const wire = kernel.l1.makeWire(edges)
    const face = kernel.l1.makeFace(wire)
    const area = kernel.l1.getSurfaceArea(face)
    console.log(`n=${n} sw=${sw}: ts window area = ${area.toFixed(6)}`)
  }
}

void main()
