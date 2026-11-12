/**
 * Probe: find the wasm makeCone "two identic radii" acceptance threshold.
 * Needed to set MIN_DR in revolve-degenerate above both the sketch-solver
 * noise floor and makeCone's refusal threshold.
 * Run: npx tsx test/probe-makecone-threshold.ts   (cwd=packages/core)
 */
import { initOcctWasm } from '../src/occt-kernel/occtKernel'

async function main(): Promise<void> {
  const k = await initOcctWasm()
  const base = 5
  for (const dr of [0, 1e-14, 1e-12, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3]) {
    let ok = true
    let vol = NaN
    try {
      const cone = k.makeCone(base, base - dr, 10)
      vol = k.getVolume(cone)
    } catch {
      ok = false
    }
    console.log(`dr=${dr.toExponential(2)} -> ${ok ? `OK vol=${vol}` : 'REFUSED (two identic radii)'}`)
  }
}

void main().catch((e) => {
  console.error('PROBE FAILED', e)
  process.exit(1)
})
