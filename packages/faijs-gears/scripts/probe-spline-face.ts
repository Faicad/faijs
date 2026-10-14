/**
 * probe-spline-face — 打印每种曲面策略实际产出的形状信息
 *
 * 用途：内核绑定行为不透明（预编译 wasm），出问题时用它看清「到底返回了什么」，
 * 而不是靠猜。属于常驻诊断脚本，不是一次性代码。
 *
 * 用法：
 *   npx tsx scripts/probe-spline-face.ts [--case spur-basic] [--strategy grid-approx]
 */

import { loadManifest } from '../test/fixtures'
import { gearKernel } from '../src/kernel'
import { initOCCT } from '../src/test-setup'
import { buildSplineFace, SPLINE_FACE_STRATEGIES, type SplineFaceStrategy } from '../src/spline-face'
import { gearIsFace } from '../src/kernel'
import { spurGearGeometry, toothFaceGrids } from '../src/profile'
import type { SpurGearParams } from '../src/profile'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  await initOCCT()
  const kernel = gearKernel()
  const caseId = arg('case') ?? 'spur-basic'
  const strategy = arg('strategy') as SplineFaceStrategy | undefined

  const c = loadManifest().cases.find((x) => x.id === caseId)
  if (!c) throw new Error(`no case ${caseId}`)

  const geom = spurGearGeometry(c.args as unknown as SpurGearParams)
  const grids = toothFaceGrids(geom)
  console.log(`case ${caseId}: rows=${grids[0].rows} cols=${grids[0].cols} twist=${geom.twistAngle}`)

  const strategies = strategy ? [strategy] : SPLINE_FACE_STRATEGIES
  for (const s of strategies) {
    console.log(`\n── strategy: ${s}`)
    for (const grid of grids) {
      let line = `   ${grid.segment.padEnd(7)}`
      try {
        const shape = buildSplineFace(kernel, grid, s)
        const type = kernel.l1.shapeType(shape)
        line += ` type=${String(type).padEnd(10)} isFace=${gearIsFace(kernel, shape)}`
        line += ` isValid=${kernel.l1.isValid(shape)}`
        line += ` faces=${kernel.l1.subShapeCount(shape, 'face')} edges=${kernel.l1.subShapeCount(shape, 'edge')}`
        try {
          line += ` area=${kernel.l1.getSurfaceArea(shape).toFixed(6)}`
        } catch (e) {
          line += ` area=<err ${(e as Error).message}>`
        }
        for (const p of grid.points.flat().slice(0, 1)) {
          try {
            const q = kernel.occt.projectPointOnFace(shape, p)
            line += ` proj(0)=${Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z).toExponential(2)}`
          } catch (e) {
            line += ` proj(0)=<err ${(e as Error).message}>`
          }
        }
      } catch (e) {
        line += ` BUILD FAILED: ${(e as Error).message}`
      }
      console.log(line)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
