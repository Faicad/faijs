import fs from 'node:fs'
import { execSync } from 'node:child_process'

// Get all files that reference 'brepkit-wasm' (the v4 package) in test/src
const out = execSync('git diff --name-only', { cwd: 'C:/my/Faicad/faijs' }).toString()
const files = out.trim().split('\n').filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))

for (const f of files) {
  const full = 'C:/my/Faicad/faijs/' + f
  if (!fs.existsSync(full)) continue
  const c = fs.readFileSync(full, 'utf8')
  // Replace require.resolve('brepkit-wasm') back to require.resolve('@faicad/brepkit2-wasm')
  // But NOT in brepkitWasm.ts (already handled) or multi-version-test.ts
  if (f.includes('brepkitWasm.ts') || f.includes('multi-version-test.ts')) continue
  let u = c
  // Fix require.resolve checks
  u = u.split("require.resolve('brepkit-wasm')").join("require.resolve('@faicad/brepkit2-wasm')")
  // Fix import() in multi-version-test
  u = u.split("import(/* @vite-ignore */ 'brepkit-wasm')").join("import(/* @vite-ignore */ '@faicad/brepkit2-wasm')")
  // Fix error messages
  u = u.split('brepkit-wasm is not installed').split('@faicad/brepkit2-wasm is not installed')
  if (c !== u) { fs.writeFileSync(full, u, 'utf8'); console.log('Updated:', f) }
}
