/**
 * _chk_profile — 端面齿廓点集与 Python 参考的对拍（case29 CrossedHelicalGear）
 *
 * 逐点比对 `SpurGearGeometry` 的四段端面点集（左齿廓/齿顶/右齿廓/齿根）与
 * `fixtures/reference/manifest.json` 里 Python 侧记录的同名数组，并打印派生量。
 *
 * 用法：npx tsx scripts/_chk_profile.ts
 */

import type { Vec3 } from '../src/math'
import { crossedHelicalGearGeometry } from '../src/profile'
import type { CrossedHelicalGearParams } from '../src/profile'
import { loadManifest } from '../test/fixtures'

const CASE_ID = 'case29-CrossedHelicalGear'

const c = loadManifest().cases.find((x) => x.id === CASE_ID)
if (!c) throw new Error(`${CASE_ID} not in manifest`)
const profile = c.profile
const derived = c.derived
if (!profile) throw new Error(`${CASE_ID} has no reference 'profile' block`)
if (!derived) throw new Error(`${CASE_ID} has no reference 'derived' block`)

const g = crossedHelicalGearGeometry(c.args as unknown as CrossedHelicalGearParams)

type SegKey = keyof NonNullable<typeof profile>
const segs: Array<[SegKey, readonly Vec3[]]> = [
  ['t_lflank_pts', g.t_lflank_pts],
  ['t_tip_pts', g.t_tip_pts],
  ['t_rflank_pts', g.t_rflank_pts],
  ['t_root_pts', g.t_root_pts],
]

// ⚠️ 本脚本此前恒印 `maxdiff=0.000e+0`：老写法是 `ours[i][k]`（k=0|1|2），但
// `t_*_pts` 的元素是 `{x,y,z}` **对象**而非数组，数字下标取到 `undefined`，
// `Math.abs(NaN) > md` 恒为 false，于是四段全部「零偏差」——空口无凭的假绿。
// 现改为按分量名取（`p.x/p.y/p.z` 对 `ref[i][0/1/2]`）。
let maxd = 0
for (const [name, ours] of segs) {
  const ref = profile[name]
  if (ours.length !== ref.length) {
    throw new Error(`${name}: point count differs — ours=${ours.length} ref=${ref.length}`)
  }
  let md = 0
  for (let i = 0; i < ours.length; i++) {
    const p = ours[i]
    const r = ref[i]
    const d = Math.max(Math.abs(p.x - r[0]), Math.abs(p.y - r[1]), Math.abs(p.z - r[2]))
    if (d > md) md = d
  }
  console.log(name + ': n=' + ours.length + ' maxdiff=' + md.toExponential(3))
  if (md > maxd) maxd = md
}

console.log('derived:')
console.log('  twistAngle ours=' + g.twistAngle + ' ref=' + derived.twist_angle)
console.log('  r0 ours=' + g.r0 + ' ref=' + derived.r0)
console.log('  rb ours=' + g.rb + ' ref=' + derived.rb)
console.log('  rr ours=' + g.rr + ' ref=' + derived.rr)
console.log('  surfaceSplines ours=' + g.surfaceSplines)
console.log('OVERALL MAX PROFILE DIFF = ' + maxd.toExponential(3))
