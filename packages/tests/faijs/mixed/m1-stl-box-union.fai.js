// M1: user-named scenario — load(stl) + box → union (mixed BREP × mesh)
let part0 = cad.load({ file: 'cube-10x5x5.stl' })
let part1 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
let part2 = cad.union(part0, part1)
