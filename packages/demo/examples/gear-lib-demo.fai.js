import * as gear from 'gear-lib-demo'

let g1 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })
let u1 = cad.union(g1, t1)