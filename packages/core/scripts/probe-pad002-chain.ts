// Probe 5: replicate the generated Pad002 sub-chain (sketch frame) and measure
// the up-to-last prism volume. Truth Pad002.AddShape = 48199.254 mm^3
// (= area 688.561 × length 70). Run: node --import tsx scripts/probe-pad002-chain.ts
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initOcctWasm, importStepToMesh } from '../src/occt-kernel/occtKernel.ts'
import { cliRun } from '../src/node-host/cli.ts'

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

// The generated Body.fai.js statement sequence, but stop at part9 (the
// sketch-frame up-to prism) and measure it.
const src = `
let part0 = cad.sketch({ contours: [{"segments":[{"kind":"line","x1":-70,"y1":0,"x2":-70,"y2":50},{"kind":"line","x1":-70,"y1":50,"x2":-60,"y2":50},{"kind":"line","x1":-60,"y1":50,"x2":-60,"y2":10},{"kind":"line","x1":-60,"y1":10,"x2":-10,"y2":10},{"kind":"line","x1":-10,"y1":10,"x2":-10,"y2":50},{"kind":"line","x1":-10,"y1":50,"x2":0,"y2":50},{"kind":"line","x1":0,"y1":50,"x2":0,"y2":10},{"kind":"line","x1":0,"y1":10,"x2":30,"y2":10},{"kind":"line","x1":30,"y1":10,"x2":30,"y2":50},{"kind":"line","x1":30,"y1":50,"x2":40,"y2":50},{"kind":"line","x1":40,"y1":50,"x2":40,"y2":0},{"kind":"line","x1":40,"y1":0,"x2":-70,"y2":0}],"closed":true}] });
let part1 = cad.extrude(part0, [0,0,100]);
let part2 = cad.rotate_euler(part1, { anglesDeg: [-89.99999999999999,0,-180] });
let part3 = cad.sketch({ contours: [{"segments":[{"kind":"arc","cx":-33.057236,"cy":30.001772,"radius":7.728417011119,"startAngle":0,"endAngle":6.283185307179586,"ccw":true,"x1":-25.328818988881004,"y1":30.001772,"x2":-25.328818988881004,"y2":30.001772}],"closed":true}] });
let part4 = cad.extrude(part3, [0,0,10.000000000103977]);
let part5 = cad.rotate_euler(part4, { anglesDeg: [0,89.99999879258174,0] });
let part6 = cad.translate(part5, { offset: [10,0,0] });
let part7 = cad.union(part2, part6);
let part8 = cad.sketch({ contours: [{"segments":[{"kind":"line","x1":21.36812,"y1":52.128868,"x2":57.38747,"y2":52.128868},{"kind":"line","x1":57.38747,"y1":52.128868,"x2":57.38747,"y2":33.012455},{"kind":"line","x1":57.38747,"y1":33.012455,"x2":21.36812,"y2":33.012455},{"kind":"line","x1":21.36812,"y1":33.012455,"x2":21.36812,"y2":52.128868}],"closed":true}] });
let part12 = cad.translate(part7, { offset: [-30,0,0] });
let part13 = cad.rotate_euler(part12, { anglesDeg: [0,89.99999879258174,0] });
let part9 = cad.extrude(part8, { upTo: "last", baseFeature: part13 });
`;

const dir = mkdtempSync('probe-pad002-')
const file = join(dir, 'probe.fai.js')
writeFileSync(file, src)
const res = await cliRun(file, { mode: 'brep', libs: undefined as never })
const shape = (res as any).outputs?.['part9']
if (!shape) {
  console.error('no part9 output; keys:', Object.keys((res as any).outputs ?? {}), 'res:', Object.keys(res))
  process.exit(1)
}
console.log('part9 (Pad002 prism, sketch frame) volume:', vol((shape as any).solid ?? shape).toFixed(3))
console.log('truth: 48199.254 (= 688.561 × 70)')
process.exit(0)
