let part0 = cad.box(20, 20, 20, { centered: true })
let part1 = cad.sphere({ radius:12, center:[0,0,0] })
let part2 = cad.intersect(part0, part1)
