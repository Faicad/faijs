/**
 * spike-chamfer — 倒角可行性尖峰（A1）
 *
 * 验证 occt-wasm 能否复现 cq_gears `_make_chamfer` + `_make_bore`：
 * ① XZ 平面三角轮廓 → 线 → 面 → revolve 360° → 旋转体 cutter
 * ② 裸齿轮 solid cut cutter（工具体只含平面 + 锥面，无 B-spline 布尔）
 * ③ bore：圆柱 cutThruAll
 * 对照官方 build() 体积（case00 = 167.845618674334，含 chamfer+bore）。
 *
 * 用法：npx tsx scripts/spike-chamfer.ts [--case case00-SpurGear]
 */

import { loadManifest } from '../src/fixtures'
import { getGearKernel } from '@faicad/cq-compat'
import { buildSpurGearSolid } from '../src/spur_gear'
import { spurGearGeometry } from '../src/profile'
import type { SpurGearParams } from '../src/profile'
import type { SplineFaceStrategy } from '../src/spline-face'
import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const E = 0.01

/**
 * 复现 `_make_chamfer` 的旋转体 cutter。
 * cadquery 里是 XZ 平面（法向 -Y）上的轮廓 revolve 360°。
 */
function chamferCutter(
  kernel: Awaited<ReturnType<typeof getGearKernel>>,
  ra: number, width: number, wx: number, wy: number, which: 'top' | 'bottom',
): BrepHandle {
  // cq XZ 工作面局部坐标 (u, v) → 世界 (u, 0, v)（XZ 面 normal=-Y，v 轴即 +Z）
  const pt = (u: number, v: number): BrepVec3 => ({ x: u, y: 0, z: v })
  const pts: BrepVec3[] =
    which === 'top'
      ? // moveTo(ra-wx, width+E) → hLine(wx+E) → vLine(-wy-E) → close
        [pt(ra - wx, width + E), pt(ra + E, width + E), pt(ra + E, width + E - wy - E), pt(ra - wx, width + E)]
      : // moveTo(ra+E, wy) → vLine(-wy-E) → hLine(-wx-E) → close
        [pt(ra + E, wy), pt(ra + E, -E), pt(ra + E - wx - E, -E), pt(ra + E, wy)]
  const edges = pts.slice(0, 3).map((p, i) => kernel.makeLineEdge(p, pts[i + 1]))
  const wire = kernel.makeWire(edges)
  const face = kernel.makeFace(wire)
  return kernel.revolve(face, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, Math.PI * 2)
}

async function main(): Promise<void> {
  const kernel = await getGearKernel()
  const caseId = arg('case') ?? 'case00-SpurGear'
  const strategy = (arg('strategy') ?? 'row-approx-loft') as SplineFaceStrategy
  const c = loadManifest().cases.find((x) => x.id === caseId)
  if (!c) throw new Error(`case ${caseId} not in manifest`)
  const a = c.args as Record<string, unknown>
  const expected = (c as unknown as { refVolume?: number }).refVolume ?? c.volume

  // 裸齿轮
  const bare = buildSpurGearSolid(kernel, c.args as unknown as SpurGearParams, { strategy })
  const vBare = kernel.getVolume(bare)
  console.log(`bare volume   = ${vBare.toFixed(6)}`)

  // 官方 expected 里的倒角/bore 参数（regression json 与 manifest args 同源）
  const chamfer = a.chamfer as number | undefined
  const boreD = a.bore_d as number | undefined
  const geom = spurGearGeometry(c.args as unknown as SpurGearParams)
  console.log(`chamfer=${chamfer} bore_d=${boreD} ra=${geom.ra} width=${geom.width}`)

  let body = bare

  // bore 先做（cq 顺序：chamfer → bore，但 cut 顺序对体积无影响；按 cq 顺序来）
  // ① chamfer（cq: _make_chamfer 在 _make_bore 之前）
  if (chamfer !== undefined && chamfer !== null) {
    const cutter = chamferCutter(kernel, geom.ra, geom.width, chamfer, chamfer, 'top')
    console.log(`cutter vol=${kernel.getVolume(cutter).toFixed(4)} valid=${kernel.isValid(cutter)}`)
    body = kernel.cut(body, cutter)
    const cutterB = chamferCutter(kernel, geom.ra, geom.width, chamfer, chamfer, 'bottom')
    body = kernel.cut(body, cutterB)
    console.log(`after chamfer = ${kernel.getVolume(body).toFixed(6)} valid=${kernel.isValid(body)}`)
  }

  // ② bore
  if (boreD !== undefined && boreD !== null) {
    const cyl = kernel.makeCylinder(boreD / 2, geom.width + 2 * E)
    const moved = kernel.translate(cyl, 0, 0, -E)
    body = kernel.cut(body, moved)
    console.log(`after bore    = ${kernel.getVolume(body).toFixed(6)} valid=${kernel.isValid(body)}`)
  }

  const vFinal = kernel.getVolume(body)
  const rel = Math.abs(vFinal - expected) / expected
  console.log(`\nfinal volume  = ${vFinal.toFixed(6)}`)
  console.log(`expected      = ${expected}`)
  console.log(`rel diff      = ${rel.toExponential(3)}  ${rel < 1e-6 ? '✅ MATCH' : '❌ MISMATCH'}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
