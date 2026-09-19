// Probe 2 (D root cause): bbox of each PadTest feature .brp to localize the
// Pad002 truncation mismatch (truth AddShape 48199.254 mm^3 vs rebuilt deficit
// ~9108 mm^3). Run: node --import tsx scripts/probe-padtest-brp-bbox.ts
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'

const zip = unzipSync(new Uint8Array(readFileSync('D:/Faicad/FreeCAD/data/tests/PadTest.fcstd')))
const docXml = Buffer.from(zip['Document.xml']!).toString('utf-8')

const names = ['Pad', 'Pad001', 'Pad002']
const kernel: any = await import('../src/occt-kernel/occtKernel.ts').then((m) => m.initOcctWasm())

for (const n of names) {
  const i = docXml.indexOf(`<Object name="${n}">`)
  const j = docXml.indexOf('</Object>', i)
  const b = docXml.slice(i, j)
  for (const p of b.matchAll(/<Property name="(\w+)"[^>]*>\s*<Part file="([^"]+)"/g)) {
    const text = Buffer.from(zip[p[2]!]!).toString('utf-8')
    const shape = kernel.fromBREP(text)
    const mesh = kernel.tessellate(shape, 0.01)
    const pos = mesh.positions as Float32Array
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
    for (let k = 0; k < pos.length; k += 3) {
      mn = [Math.min(mn[0]!, pos[k]!), Math.min(mn[1]!, pos[k + 1]!), Math.min(mn[2]!, pos[k + 2]!)]
      mx = [Math.max(mx[0]!, pos[k]!), Math.max(mx[1]!, pos[k + 1]!), Math.max(mx[2]!, pos[k + 2]!)]
    }
    const f = (v: number) => v.toFixed(3).padStart(9)
    console.log(`${n}.${p[1]} bbox x:[${f(mn[0]!)},${f(mx[0]!)}] y:[${f(mn[1]!)},${f(mx[1]!)}] z:[${f(mn[2]!)},${f(mx[2]!)}]`)
  }
}
process.exit(0)
