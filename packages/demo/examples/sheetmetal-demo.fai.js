import * as sm from 'sheetmetal'

let part = sm.author({
  thickness: 1,
  base: { length: 40, width: 30 },
  flanges: [
    { id: 'fx', length: 15, angleDeg: 90, rule: { innerRadius: 2, kFactor: 0.44 }, side: 'xmax' },
    { id: 'fy', length: 15, angleDeg: 90, rule: { innerRadius: 2, kFactor: 0.44 }, side: 'ymax' },
  ],
})
let s1 = sm.solidOf(part)
