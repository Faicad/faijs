import { crossedHelicalGearGeometry } from '../src/profile'
import { loadManifest } from '../src/fixtures'

const m = loadManifest()
const c = m.cases.find((x) => x.id === 'case29-CrossedHelicalGear')!
const g = crossedHelicalGearGeometry(c.args as any)
const prof: any = (c as any).profile
const segs: Array<[string, any[]]> = [
  ['t_lflank_pts', g.t_lflank_pts],
  ['t_tip_pts', g.t_tip_pts],
  ['t_rflank_pts', g.t_rflank_pts],
  ['t_root_pts', g.t_root_pts],
]
let maxd = 0
for (const [name, ours] of segs) {
  const ref = prof[name]
  let md = 0
  for (let i = 0; i < ours.length; i++) {
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(ours[i][k as keyof typeof ours[0]] - ref[i][k])
      if (d > md) md = d
    }
  }
  console.log(name + ': n=' + ours.length + ' maxdiff=' + md.toExponential(3))
  if (md > maxd) maxd = md
}
console.log('derived:')
console.log('  twistAngle ours=' + g.twistAngle + ' ref=' + (c as any).derived.twist_angle)
console.log('  r0 ours=' + g.r0 + ' ref=' + (c as any).derived.r0)
console.log('  rb ours=' + g.rb + ' ref=' + (c as any).derived.rb)
console.log('  rr ours=' + g.rr + ' ref=' + (c as any).derived.rr)
console.log('  surfaceSplines ours=' + g.surfaceSplines)
console.log('OVERALL MAX PROFILE DIFF = ' + maxd.toExponential(3))
