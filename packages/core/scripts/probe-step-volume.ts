// Probe 3 (D root cause residual): volume of a rebuilt STEP file via
// importStepToMesh + divergence theorem — same metrics as verify-geometry.
// Usage: node --import tsx scripts/probe-step-volume.ts <file.step>
import { readFileSync } from 'node:fs'
import { importStepToMesh } from '../src/occt-kernel/occtKernel.ts'

const stepPath = process.argv[2]!
const imp = await importStepToMesh(new Uint8Array(readFileSync(stepPath)), { linearDeflection: 0.01 })
let total = 0
imp.meshes.forEach((m, i) => {
  const pos = m.positions as Float32Array
  const idx = m.indices as Uint32Array
  let v6 = 0
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3
    v6 += pos[a]! * (pos[b + 1]! * pos[c + 2]! - pos[b + 2]! * pos[c + 1]!)
      - pos[a + 1]! * (pos[b]! * pos[c + 2]! - pos[b + 2]! * pos[c]!)
      + pos[a + 2]! * (pos[b]! * pos[c + 1]! - pos[b + 1]! * pos[c]!)
  }
  total += Math.abs(v6 / 6)
  console.log(`mesh[${i}]: ${Math.abs(v6 / 6).toFixed(3)}`)
})
console.log(`TOTAL: ${total.toFixed(3)}`)
process.exit(0)
