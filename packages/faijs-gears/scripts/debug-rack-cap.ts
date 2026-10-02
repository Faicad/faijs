/**
 * debug-rack-cap — case26 顶盖面组线诊断（一次性）
 *
 * 复刻 buildRackGearSolid 内部流程，dump z=width 处收集到的边端点与
 * connectEdgesToWires 分组结果，定位 3 环成因。
 */

import { getGearKernel } from '@faicad/cq-compat'
import {
  rackToothFaces, toothAtPosition, cutPlane, endCapFace, backFace, planarCapAtZ,
} from '../src/rack_gear'
import { rackGearGeometry } from '../src/profile'
import { connectEdgesToWires, edgeEnds } from '../src/geom-build'
import { GEAR_BASE_CONSTANTS } from '../src/profile'
import type { Vec3 } from '../src/geom-build'

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

async function main(): Promise<void> {
  const kernel = await getGearKernel()
  const geom = rackGearGeometry({ module: 4, length: 300, width: 20, height: 18, helix_angle: -60 })
  const tol = GEAR_BASE_CONSTANTS.wire_comb_tol
  const CP_EXT = 10

  const cutL = cutPlane(kernel, geom.toothHeight + CP_EXT, geom.width + CP_EXT, vec3(0, 0, geom.width / 2), vec3(-1, 0, 0))
  const cutR = cutPlane(kernel, geom.toothHeight + CP_EXT, geom.width + CP_EXT, vec3(geom.length, 0, geom.width / 2), vec3(1, 0, 0))
  const extra = Math.abs(Math.ceil(Math.tan(geom.helixAngle) * geom.width / (Math.PI * geom.m)))
  const base = rackToothFaces(kernel, geom, false, 'row-approx-loft')
  console.log('--- base tooth faces bbox ---')
  for (const f of base) {
    const bb = kernel.getBoundingBox(f)
    console.log(`  x=[${bb.xmin.toFixed(4)},${bb.xmax.toFixed(4)}] y=[${bb.ymin.toFixed(4)},${bb.ymax.toFixed(4)}] z=[${bb.zmin.toFixed(6)},${bb.zmax.toFixed(6)}]`)
  }

  const iLo = geom.helixAngle > 0 ? -extra : 0
  const iHi = geom.helixAngle > 0 ? geom.z : geom.z + extra
  const toothFaces = []
  for (let i = iLo; i <= iHi; i++) {
    toothFaces.push(...toothAtPosition(kernel, base, Math.PI * geom.m * i, i, geom, extra, cutL, cutR))
  }
  console.log('toothFaces:', toothFaces.length, 'extra:', extra, 'z:', geom.z)

  const ls = endCapFace(kernel, toothFaces, 'left', geom, tol)
  const rs = endCapFace(kernel, toothFaces, 'right', geom, tol)
  const bk = backFace(kernel, geom)
  const all = [...toothFaces, ls, rs, bk]

  // 右端盖面的全部边端点
  console.log('--- rs face edges ---')
  for (const e of kernel.getSubShapes(rs, 'edge')) {
    const ends = edgeEnds(kernel, e)
    console.log(`  (${ends.a.x.toFixed(3)},${ends.a.y.toFixed(3)},${ends.a.z.toFixed(3)}) -> (${ends.b.x.toFixed(3)},${ends.b.y.toFixed(3)},${ends.b.z.toFixed(3)})`)
  }

  // z=20 边收集 + 组环
  const edges = []
  for (const f of all) {
    for (const e of kernel.getSubShapes(f, 'edge')) {
      const bb = kernel.getBoundingBox(e)
      if (Math.abs(bb.zmin - geom.width) <= 1e-6 && Math.abs(bb.zmax - geom.width) <= 1e-6) {
        edges.push(e)
      }
    }
  }
  console.log('--- z=20 edges:', edges.length)
  const wires = connectEdgesToWires(kernel, edges, tol)
  console.log('wires:', wires.length)
  for (const w of wires) {
    const wes = kernel.getSubShapes(w, 'edge')
    const bb = kernel.getBoundingBox(w)
    console.log(`  wire: ${wes.length} edges, x=[${bb.xmin.toFixed(3)},${bb.xmax.toFixed(3)}], closed=${String(kernel.isClosedWire?.(w))}`)
  }
  // 每条 wire 的端点数（判断开/闭）
  for (let wi = 0; wi < wires.length; wi++) {
    const wes = kernel.getSubShapes(wires[wi], 'edge')
    const ends = wes.map((e: never) => edgeEnds(kernel, e))
    const pts = ends.flatMap((e: { a: Vec3; b: Vec3 }) => [e.a, e.b])
    const key = (p: Vec3) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`
    const counts = new Map<string, number>()
    for (const p of pts) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1)
    const odd = [...counts.entries()].filter(([, n]) => n % 2 === 1)
    console.log(`  wire${wi}: odd-degree endpoints: ${odd.length === 0 ? 'none (closed)' : odd.map(([k, n]) => `${k}x${n}`).join(' ; ')}`)
  }

  // 复刻 shellToSolid 各步的类型检查（完整 112 面：含 tp/bt 盖面）
  const tp = planarCapAtZ(kernel, all, geom.width)
  const bt = planarCapAtZ(kernel, all, 0)
  const closed = [...all, tp, bt]
  console.log('closed faces:', closed.length, 'tp area:', kernel.getSurfaceArea(tp).toFixed(4), 'bt area:', kernel.getSurfaceArea(bt).toFixed(4))
  const sewingTol = 1e-2
  const shell = kernel.sew(closed, sewingTol)
  console.log('sew ->', String(kernel.getShapeType(shell)), 'faces:', kernel.subShapeCount(shell, 'face'), '(输入', closed.length, '面)')

  // 路径 A：fix 在 shell 上先做，再 makeSolid
  try {
    const shellFixed = kernel.fixFaceOrientations(shell)
    const solidA = kernel.makeSolid(shellFixed)
    console.log('A fix(shell)->makeSolid:', String(kernel.getShapeType(solidA)),
      kernel.isSolid(solidA) ? `vol=${kernel.getVolume(solidA).toFixed(4)}` : '')
  } catch (e) { console.log('A failed:', String(e)) }

  // 路径 B：makeSolid 后不 fix
  const solidB = kernel.makeSolid(shell)
  console.log('B makeSolid only:', String(kernel.getShapeType(solidB)),
    kernel.isSolid(solidB) ? `vol=${kernel.getVolume(solidB).toFixed(4)}` : '')

  // 路径 D：makeSolid → 体积为负则 reverseShape
  try {
    const volB = kernel.getVolume(solidB)
    if (volB < 0) {
      const rev = kernel.reverseShape(solidB)
      console.log('D reversed:', String(kernel.getShapeType(rev)),
        kernel.isSolid(rev) ? `vol=${kernel.getVolume(rev).toFixed(4)}` : '')
    }
  } catch (e) { console.log('D failed:', String(e)) }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
