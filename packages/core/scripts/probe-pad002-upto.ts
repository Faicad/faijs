// Probe 4: run ONLY the Pad002 up-to sub-chain (sketch frame) and measure the
// extruded prism volume vs truth Pad002.AddShape = 48199.254 mm^3.
// Run: node --import tsx scripts/probe-pad002-upto.ts
import { initOcctWasm } from '../src/occt-kernel/occtKernel.ts'
import { getSolidBoundingBox } from '../src/brep/brep-utils.ts'

const kernel: any = await initOcctWasm()
const vol = (h: any): number => {
  const mesh = kernel.tessellate(h, 0.01)
  const pos = mesh.positions as Float32Array, idx = mesh.indices as Uint32Array
  let v6 = 0
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3
    v6 += pos[a]! * (pos[b + 1]! * pos[c + 2]! - pos[b + 2]! * pos[c + 1]!)
      - pos[a + 1]! * (pos[b]! * pos[c + 2]! - pos[b + 2]! * pos[c]!)
      + pos[a + 2]! * (pos[b]! * pos[c + 1]! - pos[b + 1]! * pos[c]!)
  }
  return Math.abs(v6 / 6)
}

// Rebuild Pad base (truth Pad.Shape): sketch contour placed via placement
// Q=(0,.7071,0,.7071) → rotated into global. Simpler: use the .brp truth.
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
const zip = unzipSync(new Uint8Array(readFileSync('D:/Faicad/FreeCAD/data/tests/PadTest.fcstd')))
const base = kernel.fromBREP(Buffer.from(zip['PartShape2.brp']!).toString('utf-8')) // Pad.Shape (global frame)
console.log('base volume:', vol(base).toFixed(3))

// Sketch002 contour (from generated code): rectangle 21.36812..57.38747 ×
// 33.012455..52.128868, sketch placement Q=(0,-.7071,0,.7071) P=(30,0,0).
// Sketch-local: face on local XY, extrude along local +Z.
const { cad } = await import('../src/api/index.ts') as any
// build the sketch face via runtime op path? Direct kernel: makeBoxFromCorners approximates; instead use kernel API:
// face = planar rectangle in local XY
// We instead reconstruct: rectangle w=36.01935, h=19.116413, area=688.5
const area = 36.01935 * 19.116413
console.log('sketch area:', area.toFixed(3))
console.log('truth AddShape 48199.254 / area =', (48199.254 / area).toFixed(4), 'mm (length along extrude)')
process.exit(0)
