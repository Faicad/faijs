// Temporary manual validation: open a real fcstd-port `out/batch/*.fai.zip`
// through the built @faicad/faijs-viewer and confirm meshes come out.
// Run: node scripts/verify-viewer-on-sample.mjs
// (kept as a repeatable verification probe, per repo AGENTS.md retention rule)

import { readFile } from 'node:fs/promises'
import { openFaiZip } from '../packages/faijs-viewer/dist/index.js'

const SAMPLE = process.argv[2] ?? 'C:/my/Faicad/fcstd-port/out/batch/f9c75ac9d9ab-DO-214AC.fai.zip'

const bytes = new Uint8Array(await readFile(SAMPLE))
console.error(`[verify] sample bytes: ${bytes.length}`)

// Node path: urls are validated (v1 contract) but engines auto-load locally.
const result = await openFaiZip(bytes, {
  wasm: {
    occtUrl: 'https://self-hosted/occt-wasm.wasm',
    manifoldUrl: 'https://self-hosted/manifold.wasm',
    brepkitUrl: 'https://self-hosted/brepkit_wasm_bg.wasm',
  },
})

if (result.error) {
  console.error(`[verify] ERROR ${result.error.code}: ${result.error.message}`, result.error.detail ?? '')
  process.exit(1)
}
console.log(`[verify] modelId=${result.modelId} sourceFile=${result.sourceFile ?? '(none)'} meshes=${result.meshes.length}`)
for (const m of result.meshes) {
  console.log(`  - ${m.name}: positions=${m.positions.length / 3} verts, indices=${m.indices.length / 3} tris`)
}
if (result.meshes.length === 0) {
  console.error('[verify] FAIL: no meshes')
  process.exit(1)
}
let totalTris = 0
for (const m of result.meshes) totalTris += m.indices.length / 3
console.log(`[verify] OK — total triangles: ${totalTris}`)