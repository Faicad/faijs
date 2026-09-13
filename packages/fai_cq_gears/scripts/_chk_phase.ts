import { writeFileSync } from 'node:fs'
import { getGearKernel } from '@faicad/cq-compat'
import { buildCrossedHelicalSolid } from '../src/crossed_helical_gear'
import { placeSecondGear } from '../src/crossed_pair'
import { crossedHelicalGearGeometry } from '../src/profile'
import { exportStepFromSolids } from '@faicad/faijs-core'
import { compareAssemblyFiles } from '@faicad/cq-compat'
import { loadManifest } from '../src/fixtures'

async function main() {
  const kernel = await getGearKernel()
  const c = loadManifest().cases.find((x) => x.id === 'cgp-basic')!
  const p: any = c.args
  const shaftAngleDeg: number = p.shaft_angle ?? 90
  const g1Helix = shaftAngleDeg / 2.0
  const g2Helix = shaftAngleDeg / 2.0
  const geom1 = crossedHelicalGearGeometry({ module: p.module, teeth_number: p.gear1_teeth_number, width: p.gear1_width, helix_angle: g1Helix })
  const geom2 = crossedHelicalGearGeometry({ module: p.module, teeth_number: p.gear2_teeth_number, width: p.gear2_width, helix_angle: g2Helix })
  const gear1 = buildCrossedHelicalSolid(kernel, { module: p.module, teeth_number: p.gear1_teeth_number, width: p.gear1_width, helix_angle: g1Helix })
  const gear2 = buildCrossedHelicalSolid(kernel, { module: p.module, teeth_number: p.gear2_teeth_number, width: p.gear2_width, helix_angle: g2Helix })
  const ratio = geom1.z / geom2.z
  const alignDeg = (geom2.z % 2 === 0 ? 180 / geom2.z : 0)
    + ((geom2.twistAngle * 180 / Math.PI) + (geom1.twistAngle * 180 / Math.PI) * ratio) / 2.0
  const alignRad = (alignDeg * Math.PI) / 180
  console.log('base alignDeg=' + alignDeg)
  const opts = { strictTopology: false, linearTolerance: 1e-3, volumeRelativeTolerance: 1e-6, booleanVolumeTolerance: Math.max(1e-3, 6203.8 * 1e-6), matchNames: false }
  for (const deltaDeg of [0, 9, -9, 4.5, -4.5, 18, 20.26]) {
    const placed = placeSecondGear(kernel, gear2, {
      alignAngleRad: alignRad + (deltaDeg * Math.PI) / 180,
      shaftAngleRad: (shaftAngleDeg * Math.PI) / 180,
      offsetX: geom1.r0 + geom2.r0,
      gear1Width: p.gear1_width,
      gear2Width: p.gear2_width,
    })
    const out = `out/cgp-d${deltaDeg}.step`
    const buf = exportStepFromSolids(kernel, [{ name: 'gear1', solid: gear1 }, { name: 'gear2', solid: placed }])
    writeFileSync(out, Buffer.from(buf))
    const r = await compareAssemblyFiles('fixtures/reference/cgp-basic.step', out, opts)
    console.log(`delta=${deltaDeg}\tboolAB=${r.overall.booleanDiff.aMinusB.toExponential(3)}\tboolBA=${r.overall.booleanDiff.bMinusA.toExponential(3)}\tequiv=${r.equivalent}`)
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
