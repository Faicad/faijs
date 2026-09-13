/**
 * probe-gear — 齿轮实体构造的分步诊断
 *
 * 内核绑定行为不透明，出问题时要能看清「哪一步开始错」。
 * 常驻诊断脚本，不是一次性代码。
 *
 * 用法：
 *   npx tsx scripts/probe-gear.ts [--case spur-basic] [--strategy row-approx-loft]
 */

import { loadManifest, type ReferenceCase } from '../src/fixtures'
import { getGearKernel } from '@faicad/cq-compat'
import { planarCapAtZ, buildToothFaces } from '../src/spur_gear'
import { spurGearGeometry } from '../src/profile'
import type { SpurGearParams } from '../src/profile'
import type { SplineFaceStrategy } from '../src/spline-face'
import type { BrepHandle } from '@faicad/faijs-core'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function info(k: ReturnType<typeof getGearKernel> extends Promise<infer T> ? T : never, s: BrepHandle, label: string): void {
  const bb = k.getBoundingBox(s)
  console.log(
    `   ${label.padEnd(22)} type=${String(k.getShapeType(s)).padEnd(8)} valid=${k.isValid(s)} ` +
    `F=${k.subShapeCount(s, 'face')} E=${k.subShapeCount(s, 'edge')} S=${k.subShapeCount(s, 'solid')} ` +
    `vol=${k.getVolume(s).toFixed(4).padStart(12)} bbox=[${bb.xmin.toFixed(3)},${bb.ymin.toFixed(3)},${bb.zmin.toFixed(3)}]..[${bb.xmax.toFixed(3)},${bb.ymax.toFixed(3)},${bb.zmax.toFixed(3)}]`,
  )
}

async function main(): Promise<void> {
  const kernel = await getGearKernel()
  const caseId = arg('case') ?? 'spur-basic'
  const strategy = (arg('strategy') ?? 'row-approx-loft') as SplineFaceStrategy
  const c = loadManifest().cases.find((x) => x.id === caseId) as ReferenceCase
  const geom = spurGearGeometry(c.args as unknown as SpurGearParams)

  console.log(`case ${caseId}  z=${geom.z} tau=${geom.tau} width=${geom.width} twist=${geom.twistAngle} strategy=${strategy}`)

  // ① 基础齿面
  const grids = (await import('../src/profile')).toothFaceGrids(geom)
  const { buildSplineFace } = await import('../src/spline-face')
  const base = grids.map((g) => buildSplineFace(kernel, g, strategy))
  console.log('① 基础齿面：')
  base.forEach((f, i) => info(kernel, f, grids[i].segment))

  // ② rotate 是否就地修改？
  console.log('② kernel.rotate 语义检查：')
  const axis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
  const r1 = kernel.rotate(base[0], axis, geom.tau)
  const r2 = kernel.rotate(base[0], axis, geom.tau * 2)
  const bb0 = kernel.getBoundingBox(base[0])
  const bb1 = kernel.getBoundingBox(r1)
  const bb2 = kernel.getBoundingBox(r2)
  console.log(`   base bbox.xmin=${bb0.xmin.toFixed(6)}  rotate(tau) xmin=${bb1.xmin.toFixed(6)}  rotate(2tau) xmin=${bb2.xmin.toFixed(6)}`)
  console.log(`   base 是否被就地修改: ${Math.abs(bb0.xmin - kernel.getBoundingBox(base[0]).xmin) > 1e-12}`)

  // ③ 全部齿面
  const faces = buildToothFaces(kernel, geom, strategy)
  console.log(`③ 齿面总数 = ${faces.length}（期望 ${4 * geom.z}）`)

  // ④ 端盖
  for (const z of [0, geom.width]) {
    console.log(`④ z=${z} 平面上的边：`)
    let n = 0
    for (const f of faces) {
      for (const e of kernel.getSubShapes(f, 'edge')) {
        const bb = kernel.getBoundingBox(e)
        if (Math.abs(bb.zmin - z) <= 1e-6 && Math.abs(bb.zmax - z) <= 1e-6) n++
      }
    }
    console.log(`   找到 ${n} 条边（期望 ${4 * geom.z}）`)
    try {
      const cap = planarCapAtZ(kernel, faces, z)
      info(kernel, cap, `cap@${z}`)
    } catch (e) {
      console.log(`   cap 失败: ${(e as Error).message}`)
    }
  }

  // ⑤ 缝合 / 实体化
  const capBottom = planarCapAtZ(kernel, faces, 0)
  const capTop = planarCapAtZ(kernel, faces, geom.width)
  const all = [...faces, capTop, capBottom]
  const shell = kernel.sew(all, 1e-2)
  console.log('⑤ sew：')
  info(kernel, shell, 'shell')
  const solid = kernel.makeSolid(shell)
  info(kernel, solid, 'solid')
  const fixed = kernel.fixFaceOrientations(solid)
  info(kernel, fixed, 'fixFaceOrientations')
  const healed = kernel.healSolid(solid, 1e-2)
  info(kernel, healed, 'healSolid')
  console.log(`   参考体积 = ${c.volume}`)

  // ⑥ 布尔差诊断（STEP 比对里的 boolean diff 失败时看这里）
  const { readFileSync } = await import('node:fs')
  const { stepPath } = await import('../src/fixtures')
  const { buildOurShape } = await import('./export-ours')
  const ours = buildOurShape(kernel, c, strategy)
  const ref = kernel.importStep(readFileSync(stepPath(c.id)).buffer as ArrayBuffer)
  console.log('⑥ 布尔差：')
  info(kernel, ours, 'ours')
  info(kernel, ref, 'reference')
  for (const [label, x, y] of [['A-B', ref, ours], ['B-A', ours, ref]] as const) {
    const d = kernel.cut(x, y)
    const bb = kernel.getBoundingBox(d)
    console.log(
      `   cut(${label}) valid=${kernel.isValid(d)} type=${String(kernel.getShapeType(d))} ` +
      `F=${kernel.subShapeCount(d, 'face')} S=${kernel.subShapeCount(d, 'solid')} ` +
      `vol=${kernel.getVolume(d).toExponential(4)} bboxSize=${(bb.xmax - bb.xmin).toFixed(3)}×${(bb.ymax - bb.ymin).toFixed(3)}×${(bb.zmax - bb.zmin).toFixed(3)}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
