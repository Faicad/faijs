#!/usr/bin/env npx tsx
/** Print geometry summary for all mini_lathe parts. */
import { readFileSync } from 'node:fs'
import { initOcctWasm } from '@faicad/faijs-core'

const parts = ['bottom_plate', 'middle_bottom', 'middle_top', 'top_plate', 'axk', 'slide_top', 'slide_mid']
const dir = 'packages/mini_lathe/out'

async function main() {
  const kernel = await initOcctWasm()
  console.log('| Part | Volume (mm³) | BBox X | BBox Y | BBox Z | Faces | Edges | Verts |')
  console.log('|------|-------------|--------|--------|--------|-------|-------|-------|')
  for (const p of parts) {
    const buf = readFileSync(`${dir}/${p}.step`)
    const shape = kernel.importStep(buf.buffer as ArrayBuffer)
    const vol = kernel.getVolume(shape)
    const bb = kernel.getBoundingBox(shape)
    const faces = kernel.getSubShapes(shape, 'face').length
    const edges = kernel.getSubShapes(shape, 'edge').length
    const verts = kernel.getSubShapes(shape, 'vertex').length
    const dx = (bb.xmax - bb.xmin).toFixed(1)
    const dy = (bb.ymax - bb.ymin).toFixed(1)
    const dz = (bb.zmax - bb.zmin).toFixed(1)
    console.log(`| ${p} | ${vol.toFixed(1)} | ${dx} | ${dy} | ${dz} | ${faces} | ${edges} | ${verts} |`)
    kernel.release(shape)
  }
}
main()
