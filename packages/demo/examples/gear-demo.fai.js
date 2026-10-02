import * as gears from '@faicad/faijs-gears'

let g1 = gears.spurGear({ module: 2, teeth_number: 24, width: 8 })
let g2 = gears.spurGear({ module: 2, teeth_number: 12, width: 8 })
let m1 = cad.translate(g2, { offset: [36, 0, 0] })
let u1 = cad.union(g1, m1)
