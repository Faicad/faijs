/** One-off probe: failing spur case bbox across the 3 spline-face strategies. */
import { getGearKernel } from '../../src/kernel'
import { buildSpurGearSolid } from '../../src/spur_gear'
import { spurGearGeometry } from '../../src/profile'
import { GEAR_SPLINE_FACE_STRATEGIES } from '../../src/kernel'

const params = {
  module: 2.536741155560594, teeth_number: 177, width: 745.762991226348,
  pressure_angle: 9.55654464615509, helix_angle: -42.3844626871869,
}
const g = spurGearGeometry(params)
console.log(`ra*2=${g.ra * 2}`)

const kernel = await getGearKernel()
for (const s of GEAR_SPLINE_FACE_STRATEGIES) {
  const solid = buildSpurGearSolid(kernel, params, { strategy: s })
  const bb = kernel.getBoundingBox(solid, false)
  const maxd = Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin)
  console.log(`${s}: maxd=${maxd} delta=${maxd - g.ra * 2} vol=${kernel.getVolume(solid)}`)
}
