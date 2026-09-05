// M4: all-BREP control — box + box → union (must stay on BREP path, zero change)
let part0 = cad.box(20, 20, 20, { centered: true })
let part1 = cad.box(20, 20, 20, { centered: true, at: [10, 0, 0] })
let part2 = cad.union(part0, part1)
