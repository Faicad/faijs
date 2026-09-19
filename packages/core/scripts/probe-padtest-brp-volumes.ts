// Probe (D root cause, PadTest): per-feature .brp truth volumes vs rebuilt
// volumes, to localize the residual 3.2-3.4% volume deficit.
// Run: node --import tsx scripts/probe-padtest-brp-volumes.ts
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'

const zip = unzipSync(new Uint8Array(readFileSync('D:/Faicad/FreeCAD/data/tests/PadTest.fcstd')))
const docXml = Buffer.from(zip['Document.xml']!).toString('utf-8')

const names = ['Sketch', 'Pad', 'Sketch001', 'Pad001', 'Sketch002', 'Pad002', 'Body']
const brpOf = new Map<string, Map<string, string>>()
for (const n of names) {
  const i = docXml.indexOf(`<Object name="${n}">`)
  const j = docXml.indexOf('</Object>', i)
  const b = docXml.slice(i, j)
  const m = new Map<string, string>()
  for (const p of b.matchAll(/<Property name="(\w+)"[^>]*>\s*<Part file="([^"]+)"/g)) m.set(p[1]!, p[2]!)
  brpOf.set(n, m)
}

const kernel: any = await import('../src/occt-kernel/occtKernel.ts').then((m) => m.initOcctWasm())

function volOf(brpName: string): number | null {
  const data = zip[brpName]
  if (!data) return null
  const text = Buffer.from(data).toString('utf-8')
  if (!text.includes('CASCADE Topology V1')) return null
  try {
    const shape = kernel.fromBREP(text)
    const mesh = kernel.tessellate(shape, 0.01)
    // signed volume from triangles
    let v = 0
    const pos = mesh.positions as Float32Array
    const idx = mesh.indices as Uint32Array
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k]! * 3, b2 = idx[k + 1]! * 3, c = idx[k + 2]! * 3
      v += (
        pos[a]! * (pos[b2 + 1]! * pos[c + 2]! - pos[b2 + 2]! * pos[c + 1]!) -
        pos[a + 1]! * (pos[b2]! * pos[c + 2]! - pos[b2 + 2]! * pos[c]!) +
        pos[a + 2]! * (pos[b2]! * pos[c + 1]! - pos[b2 + 1]! * pos[c]!)
      ) / 6
    }
    return Math.abs(v)
  } catch (e) {
    return null
  }
}

console.log('per-feature truth volumes (deflection 0.01):')
for (const n of names) {
  const m = brpOf.get(n)!
  for (const [prop, file] of m) {
    const v = volOf(file)
    console.log(`  ${n}.${prop} (${file}): ${v === null ? 'n/a' : v.toFixed(3)}`)
  }
}
process.exit(0)
