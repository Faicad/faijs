// M1: user-named scenario — load(stl) + box → union (mixed BREP × mesh)
let part0 = cad.load({ key: 'cube-10x5x5' })
let part1 = cad.box(20 * mm, 20 * mm, 20 * mm, { centered: true })
let part2 = cad.union(part0, part1)
