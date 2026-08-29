// M3: BREP × SDF — sdf + box → union (mixed)
let part0 = cad.sdf({ code: 'function sdf(x, y, z) { return Math.sqrt(x*x + y*y + z*z) - 10 }', box: [[-15, -15, -15], [15, 15, 15]], resolution: 1 })
let part1 = cad.box({ size: 20 })
let part2 = cad.union(part0, part1)
