/**
 * probe-sprocket-vol.ts — 隔离平齿倒角的体积差：
 * 无倒角 V0 → 本实现倒角 V1 → 与 A 侧 manifest 体积对照。
 */
import { setupWarehouseKernel } from '../src/test-setup'
import { requireKernel } from '../src/kernel'
import { buildSprocket } from '../src/sprocket'
import { volumeOf } from '../src/primitives'

async function main(): Promise<void> {
  await setupWarehouseKernel()
  requireKernel()
  for (const [tag, p] of [
    ['16t', { numTeeth: 16, chainPitch: 12.7, rollerDiameter: 7.9375 }],
    ['32t-mount', { numTeeth: 32, boltCircleDiameter: 104.0, numMountBolts: 4, mountBoltDiameter: 8.0, boreDiameter: 80.0 }],
  ] as const) {
    const r = buildSprocket(p)
    console.log(`${tag}: vol=${volumeOf(r.handle).toFixed(4)} flat=${r.flatTeeth} outerR=${r.outerRadius.toFixed(6)}`)
  }
  console.log('A-side: 16t=6552.2962 32t-mount=15852.685 (manifest)')
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
