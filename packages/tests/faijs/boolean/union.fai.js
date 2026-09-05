let part0 = cad.box(20, 20, 20, { centered: true })
let part1 = cad.box(20, 20, 20, { centered: true, at: [10,0,0] })
let part2 = cad.union(part0, part1)
