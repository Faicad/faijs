/**
 * probe-worm7.ts — 三种建面策略下的 Worm 体积 vs manifest 参考
 */
import { getGearKernel } from '@faicad/cq-compat'
import { wormGeometry } from '../src/profile'
import { buildWormSolid } from '../src/worm_gear'
import { SPLINE_FACE_STRATEGIES } from '../src/spline-face'

const REF = { 'worm-basic': 79.9286, 'worm-2threads': 449.6363 }

async function main(): Promise<void> {
  const kernel = await getGearKernel()
  const cases = [
    { id: 'worm-basic', params: { module: 1.0, lead_angle: 20.0, n_threads: 1, length: 10.0 } },
    { id: 'worm-2threads', params: { module: 1.0, lead_angle: 15.0, n_threads: 2, length: 10.0 } },
  ]
  for (const strategy of SPLINE_FACE_STRATEGIES) {
    for (const c of cases) {
      try {
        const solid = buildWormSolid(kernel, c.params, { strategy })
        const vol = kernel.getVolume(solid)
        const ref = REF[c.id as keyof typeof REF]
        console.log(`${strategy} ${c.id}: vol=${vol.toFixed(4)} ref=${ref} rel=${Math.abs(vol - ref) / ref}`)
      } catch (e) {
        console.log(`${strategy} ${c.id}: FAILED — ${(e as Error).message}`)
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
